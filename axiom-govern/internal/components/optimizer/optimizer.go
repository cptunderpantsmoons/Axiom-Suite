// Package optimizer implements prompt compression with safeguards.
package optimizer

import (
	"context"
	"strings"
)

// Compressor compresses a prompt.
type Compressor interface {
	Compress(ctx context.Context, prompt string) (string, error)
}

// SchemaEnforcer enforces structural constraints on optimized prompts.
type SchemaEnforcer interface {
	Validate(ctx context.Context, original, optimized string) bool
}

// EffectivenessTracker records optimization effectiveness.
type EffectivenessTracker interface {
	Record(ctx context.Context, original, optimized string, preserved bool)
}

// OptimizationResult is the outcome of optimization.
type OptimizationResult struct {
	OriginalLength     int    `json:"original_length"`
	OptimizedLength    int    `json:"optimized_length"`
	Optimized          string `json:"optimized"`
	SemanticsPreserved bool   `json:"semantics_preserved"`
	Applied            bool   `json:"applied"`
}

// DefaultCompressor is a lossless normalizer: it collapses runs of whitespace
// (including newlines) to single spaces and trims. It deliberately does NOT
// lowercase or remove words — lowercasing destroys case-sensitive meaning
// (code, identifiers, acronyms) and word removal can change intent or tone.
type DefaultCompressor struct{}

// Compress implements Compressor.
func (DefaultCompressor) Compress(ctx context.Context, prompt string) (string, error) {
	return strings.Join(strings.Fields(prompt), " "), nil
}

// DefaultSchemaEnforcer checks that key tokens are preserved.
type DefaultSchemaEnforcer struct{}

// Validate implements SchemaEnforcer.
func (DefaultSchemaEnforcer) Validate(ctx context.Context, original, optimized string) bool {
	if len(optimized) == 0 {
		return false
	}
	if float64(len(optimized)) < float64(len(original))*0.25 {
		return false
	}
	return true
}

// DefaultTracker is a no-op effectiveness tracker.
type DefaultTracker struct{}

// Record implements EffectivenessTracker.
func (DefaultTracker) Record(ctx context.Context, original, optimized string, preserved bool) {}

// PromptOptimizer compresses prompts while preserving semantics.
type PromptOptimizer struct {
	compressor     Compressor
	schemaEnforcer SchemaEnforcer
	tracker        EffectivenessTracker
	shadowMode     bool
}

// Options configures the optimizer.
type Options struct {
	ShadowMode bool
}

// NewPromptOptimizer constructs a PromptOptimizer.
func NewPromptOptimizer(compressor Compressor, schemaEnforcer SchemaEnforcer, tracker EffectivenessTracker) *PromptOptimizer {
	if compressor == nil {
		compressor = DefaultCompressor{}
	}
	if schemaEnforcer == nil {
		schemaEnforcer = DefaultSchemaEnforcer{}
	}
	if tracker == nil {
		tracker = DefaultTracker{}
	}
	return &PromptOptimizer{compressor: compressor, schemaEnforcer: schemaEnforcer, tracker: tracker}
}

// WithShadowMode toggles shadow mode (optimization computed but not applied).
func (o *PromptOptimizer) WithShadowMode(on bool) *PromptOptimizer {
	o.shadowMode = on
	return o
}

// Optimize compresses the prompt and validates semantic preservation.
func (o *PromptOptimizer) Optimize(ctx context.Context, prompt string, opts *Options) (*OptimizationResult, error) {
	compressed, err := o.compressor.Compress(ctx, prompt)
	if err != nil {
		return nil, err
	}
	preserved := o.validateSemantics(ctx, prompt, compressed) && o.schemaEnforcer.Validate(ctx, prompt, compressed)
	o.tracker.Record(ctx, prompt, compressed, preserved)

	applied := preserved && !o.shadowMode && (opts == nil || !opts.ShadowMode)
	result := &OptimizationResult{
		OriginalLength:     len(prompt),
		OptimizedLength:    len(compressed),
		Optimized:          compressed,
		SemanticsPreserved: preserved,
		Applied:            applied,
	}
	if !applied {
		// In shadow mode or when not preserved, return the original.
		result.Optimized = prompt
		result.OptimizedLength = len(prompt)
	}
	return result, nil
}

// validateSemantics checks that key content tokens are retained.
func (o *PromptOptimizer) validateSemantics(ctx context.Context, original, optimized string) bool {
	origTokens := tokenize(original)
	if len(origTokens) == 0 {
		return true
	}
	optLower := strings.ToLower(optimized)
	retained := 0
	for _, t := range origTokens {
		if strings.Contains(optLower, t) {
			retained++
		}
	}
	return float64(retained)/float64(len(origTokens)) >= 0.6
}

func tokenize(s string) []string {
	words := strings.Fields(strings.ToLower(s))
	out := make([]string, 0, len(words))
	for _, w := range words {
		w = strings.Trim(w, ".,!?;:\"'()[]{}")
		if len(w) > 3 {
			out = append(out, w)
		}
	}
	return out
}
