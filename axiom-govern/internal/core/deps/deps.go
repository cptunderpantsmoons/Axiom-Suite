// Package deps bundles the constructed components for the Harness services.
package deps

import (
	"context"
	"crypto/ed25519"

	"github.com/redis/go-redis/v9"

	"github.com/laiw/management-harness/internal/components/auth"
	"github.com/laiw/management-harness/internal/components/budget"
	"github.com/laiw/management-harness/internal/components/cache"
	"github.com/laiw/management-harness/internal/components/guardian"
	"github.com/laiw/management-harness/internal/components/optimizer"
	"github.com/laiw/management-harness/internal/components/policy"
	"github.com/laiw/management-harness/internal/components/provenance"
	"github.com/laiw/management-harness/internal/components/router"
	"github.com/laiw/management-harness/internal/components/skills"
	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/providers"
	"github.com/laiw/management-harness/internal/observability/audit"
	"github.com/laiw/management-harness/internal/observability/metrics"
	"github.com/laiw/management-harness/internal/observability/savings"
)

// Dependencies holds all wired components for a running service.
type Dependencies struct {
	Config       *config.Config
	Metrics      *metrics.MetricsCollector
	Audit        *audit.AuditLogger
	Auth         *auth.AuthGateway
	Budget       *budget.BudgetEnforcer
	Guardian     *guardian.Guardian
	Router       *router.ModelRouter
	Cache        *cache.ResponseCache
	PolicyEngine *policy.PolicyEngine
	Optimizer    *optimizer.PromptOptimizer
	KeyStore     interfaces.KeyStore
	BudgetStore  interfaces.BudgetStore
	Providers    *providers.Registry
	RuntimeStore *config.RuntimeStore
	Skills       *skills.Registry
	SkillEngine  *skills.Engine
	SkillStore   *skills.Store
	Savings      savings.Store
	Pricing      interfaces.Pricing
	// Provenance (Proof of Source / Proof of Human)
	ProvenanceSigner    *provenance.Signer
	ProvenancePublicKey ed25519.PublicKey
	RedisClient         *redis.Client
	PolicyStop          context.CancelFunc
}
