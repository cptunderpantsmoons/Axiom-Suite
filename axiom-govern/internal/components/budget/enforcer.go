// Package budget implements per-identity budget enforcement.
package budget

import (
	"context"
	"errors"
	"net/http"

	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/components/auth"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// ErrBudgetExceeded is returned when a request would breach the hard limit.
var ErrBudgetExceeded = errors.New("budget: hard limit exceeded")

// AlertSender delivers budget threshold alerts.
type AlertSender interface {
	Send(ctx context.Context, identity *models.Identity, budget *models.Budget, usage *models.BudgetUsage) error
}

// BudgetEnforcer checks and records budget usage.
type BudgetEnforcer struct {
	store interfaces.BudgetStore
	cache interfaces.Cache
	alert AlertSender
	log   *zap.Logger
}

// NewBudgetEnforcer constructs a BudgetEnforcer.
func NewBudgetEnforcer(store interfaces.BudgetStore, cache interfaces.Cache, alert AlertSender) *BudgetEnforcer {
	return &BudgetEnforcer{
		store: store,
		cache: cache,
		alert: alert,
		log:   zap.L().Named("budget"),
	}
}

// Check verifies the estimated cost would not exceed the hard limit.
func (e *BudgetEnforcer) Check(ctx context.Context, identity *models.Identity, estimatedCost float64) error {
	budget, err := e.store.GetBudget(ctx, identity)
	if err != nil {
		return err
	}
	if budget.HardLimit <= 0 {
		// No limit configured; allow.
		return nil
	}
	usage, err := e.store.GetUsage(ctx, identity)
	if err != nil {
		return err
	}
	if usage.TotalSpend+estimatedCost > budget.HardLimit {
		e.log.Warn("budget hard limit would be exceeded",
			zap.String("user_id", identity.UserID),
			zap.Float64("spend", usage.TotalSpend),
			zap.Float64("estimated", estimatedCost),
			zap.Float64("hard_limit", budget.HardLimit))
		return ErrBudgetExceeded
	}
	return nil
}

// RecordUsage records cost and tokens after a successful request.
func (e *BudgetEnforcer) RecordUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error {
	if err := e.store.IncrementUsage(ctx, identity, cost, tokens); err != nil {
		return err
	}
	if e.alert != nil {
		if budget, err := e.store.GetBudget(ctx, identity); err == nil {
			if usage, err := e.store.GetUsage(ctx, identity); err == nil {
				if budget.SoftLimit > 0 && usage.TotalSpend >= budget.SoftLimit {
					if err := e.alert.Send(ctx, identity, budget, usage); err != nil {
						e.log.Warn("failed to send budget alert", zap.Error(err))
					}
				}
			}
		}
	}
	return nil
}

// Middleware enforces budget before invoking the next handler. It expects an
// identity in the context (from the auth middleware) and the estimated cost in
// the request context under costCtxKey.
type costKey struct{}

// WithEstimatedCost stores the estimated cost for the middleware chain.
func WithEstimatedCost(ctx context.Context, cost float64) context.Context {
	return context.WithValue(ctx, costKey{}, cost)
}

// EstimatedCostFromContext retrieves the estimated cost.
func EstimatedCostFromContext(ctx context.Context) (float64, bool) {
	c, ok := ctx.Value(costKey{}).(float64)
	return c, ok
}

// Middleware enforces budget before invoking the next handler.
func (e *BudgetEnforcer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := extractIdentity(r.Context())
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		cost, _ := EstimatedCostFromContext(r.Context())
		if err := e.Check(r.Context(), identity, cost); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write([]byte(`{"error":"budget_exceeded","message":"hard budget limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func extractIdentity(ctx context.Context) (*models.Identity, bool) {
	return auth.IdentityFromContext(ctx)
}
