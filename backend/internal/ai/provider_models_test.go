package ai

import (
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
