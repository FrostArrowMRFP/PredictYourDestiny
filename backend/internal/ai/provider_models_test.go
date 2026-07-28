package ai

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestDecodeProviderModelsDeduplicatesSortsAndFilters(t *testing.T) {
	raw := `{"data":[{"id":"z-model"},{"id":" a-model "},{"id":"z-model"},{"id":""}]}`
	models, err := decodeProviderModels(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "a-model" || models[1] != "z-model" {
		t.Fatalf("models = %#v", models)
	}
}

func TestDecodeProviderModelsRejectsMalformedPayload(t *testing.T) {
	if _, err := decodeProviderModels(strings.NewReader(`{"data":`)); err == nil {
		t.Fatal("expected malformed payload error")
	}
}

func TestLiveProviderModelDiscovery(t *testing.T) {
	baseURL := os.Getenv("TEST_AI_PROVIDER_BASE_URL")
	apiKey := os.Getenv("TEST_AI_PROVIDER_API_KEY")
	if baseURL == "" || apiKey == "" {
		t.Skip("set TEST_AI_PROVIDER_BASE_URL and TEST_AI_PROVIDER_API_KEY to run")
	}
	models, err := DiscoverProviderModels(context.Background(), baseURL, apiKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) == 0 {
		t.Fatal("provider returned no models")
	}
}
