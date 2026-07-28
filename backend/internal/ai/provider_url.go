package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

var ErrUnsafeProviderURL = errors.New("ai: unsafe provider URL")

// ValidateProviderBaseURL accepts only public HTTPS endpoints. The runtime
// transport repeats the address check after DNS resolution to prevent a
// hostname from resolving to loopback, link-local, or private infrastructure.
func ValidateProviderBaseURL(raw string, allowPrivate bool) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("%w: invalid URL", ErrUnsafeProviderURL)
	}
	if u.Scheme != "https" && !(allowPrivate && u.Scheme == "http") {
		return fmt.Errorf("%w: HTTPS is required", ErrUnsafeProviderURL)
	}
	if u.User != nil {
		return fmt.Errorf("%w: embedded credentials are not allowed", ErrUnsafeProviderURL)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("%w: query and fragment are not allowed", ErrUnsafeProviderURL)
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("%w: localhost is not allowed", ErrUnsafeProviderURL)
	}
	if addr, err := netip.ParseAddr(host); err == nil && !allowPrivate && !isPublicProviderAddr(addr) {
		return fmt.Errorf("%w: private or special-use address is not allowed", ErrUnsafeProviderURL)
	}
	return nil
}

func isPublicProviderAddr(addr netip.Addr) bool {
	return addr.IsValid() && !addr.IsLoopback() && !addr.IsPrivate() &&
		!addr.IsLinkLocalUnicast() && !addr.IsLinkLocalMulticast() &&
		!addr.IsMulticast() && !addr.IsUnspecified() && !isProxyFakeIP(addr)
}

func newProviderHTTPClient() *http.Client {
	allowProxyFakeIPs := strings.EqualFold(strings.TrimSpace(os.Getenv("AI_PROVIDER_ALLOW_PROXY_FAKE_IPS")), "true")
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		MaxIdleConns:    20,
		IdleConnTimeout: 90 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, fmt.Errorf("provider address: %w", err)
			}
			resolved, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			addr, ok := selectProviderAddr(resolved, allowProxyFakeIPs)
			if !ok {
				return nil, fmt.Errorf("%w: DNS resolved only to private or special-use addresses", ErrUnsafeProviderURL)
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
		},
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many provider redirects")
			}
			return ValidateProviderBaseURL(req.URL.String(), false)
		},
	}
}

var proxyFakeIPPrefixes = []netip.Prefix{
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("fdfe:dcba:9876::/48"),
}

func isProxyFakeIP(addr netip.Addr) bool {
	for _, prefix := range proxyFakeIPPrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func selectProviderAddr(resolved []netip.Addr, allowProxyFakeIPs bool) (netip.Addr, bool) {
	for _, addr := range resolved {
		if isPublicProviderAddr(addr) {
			return addr, true
		}
	}
	if allowProxyFakeIPs {
		for _, wantIPv4 := range []bool{true, false} {
			for _, addr := range resolved {
				if addr.Is4() == wantIPv4 && isProxyFakeIP(addr) {
					return addr, true
				}
			}
		}
	}
	return netip.Addr{}, false
}

// CheckProviderHealth performs a cheap authenticated GET /models probe. It
// uses the same SSRF-safe transport as completions and never invokes a model.
func CheckProviderHealth(ctx context.Context, baseURL, apiKey string) (time.Duration, error) {
	if err := ValidateProviderBaseURL(baseURL, false); err != nil {
		return 0, err
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return 0, err
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/models"

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	started := time.Now()
	resp, err := newProviderHTTPClient().Do(req)
	duration := time.Since(started)
	if err != nil {
		return duration, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 32<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return duration, fmt.Errorf("provider health check returned HTTP %d", resp.StatusCode)
	}
	return duration, nil
}

// DiscoverProviderModels returns the model IDs advertised by an
// OpenAI-compatible GET /models endpoint. The response is bounded and model
// IDs are deduplicated so a provider cannot make the admin UI consume
// unbounded memory.
func DiscoverProviderModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	if err := ValidateProviderBaseURL(baseURL, false); err != nil {
		return nil, err
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, err
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/models"
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := newProviderHTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 32<<10))
		return nil, fmt.Errorf("provider model discovery returned HTTP %d", resp.StatusCode)
	}
	return decodeProviderModels(io.LimitReader(resp.Body, (2<<20)+1))
}

func decodeProviderModels(reader io.Reader) ([]string, error) {
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode provider models: %w", err)
	}
	if len(payload.Data) > 5000 {
		return nil, errors.New("provider returned too many models")
	}
	seen := make(map[string]struct{}, len(payload.Data))
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" || len(id) > 128 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		models = append(models, id)
	}
	sort.Strings(models)
	return models, nil
}
