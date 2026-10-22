export type AmpLevel = "L0" | "L1" | "L2";
export type AmpVerb = "declare" | "attend" | "act" | "resolve" | "account";
export type AmpEffectKind = "read" | "write" | "network" | "spend" | "irreversible" | "grant" | "process";
export type AmpTaint = "trusted" | "untrusted" | "mixed";
export type AmpCaseState = "open" | "completed" | "failed";
export type AmpOutcome = "success" | "failure" | "unknown";

export interface AmpResources {
    usd: string;
    compute_ms: number;
    energy_wh: number;
    human_items: number;
}

export interface AmpBudget {
    tokens: number;
    time_ms: number;
    space_bytes: number;
    capability_load: number;
    resources: AmpResources;
    risk: number;
}

export interface AmpCost {
    tokens: number;
    time_ms: number;
    space_bytes: number;
    capability_load: number;
    resources: AmpResources;
    risk: number;
}

export interface AmpBelief {
    prior: number;
    prior_source: string;
    evidence: string[];
    log_odds: number;
    posterior: number;
    model: string;
    dependence?: AmpDependence;
    trace?: AmpBeliefTrace;
}

export type AmpLikelihood =
    | {
        model: "binary";
        sensitivity: number;
        false_positive_rate: number;
        lr_plus: number;
        lr_minus: number;
    }
    | {
        model: "normal";
        mu_true: number;
        sigma_true: number;
        mu_false: number;
        sigma_false: number;
    }
    | {
        model: "beta-binomial";
        alpha: number;
        beta: number;
    };

export interface AmpEvidence {
    id: string;
    source: string;
    method: string;
    observed_at: string;
    taint: AmpTaint;
    outcome?: "positive" | "negative";
    value?: number;
    likelihood: AmpLikelihood;
    calibration?: {
        n: number;
        auc?: number;
        brier?: number;
        ece?: number;
        updated_at: string;
    };
    depends_on: string[];
    cluster?: string;
    weight?: number;
}

export interface AmpDependence {
    rho: number;
    clusters: number;
    model: string;
}

export interface AmpLikelihoodContribution {
    evidence_id: string;
    cluster: string;
    weight: number;
    log_lr: number;
    effective_log_lr: number;
}

export interface AmpBeliefTrace {
    prior_log_odds: number;
    contributions: AmpLikelihoodContribution[];
    effective_log_odds: number;
    posterior: number;
    prior_sensitivity: {
        low: number;
        high: number;
        flips: boolean;
    };
}

export interface AmpBetaPrior {
    mu: number;
    kappa: number;
}

export interface AmpBetaPosterior {
    alpha: number;
    beta: number;
    mean: number;
    sd: number;
    n: number;
    credible_interval: [number, number];
}

export interface AmpCalibrationSample {
    probability: number;
    outcome: 0 | 1;
}


export interface AmpClaim {
    id: string;
    subject: string;
    predicate: string;
    object: unknown;
    confidence: number;
    belief?: AmpBelief;
    observed_at: string;
    valid_until: string;
    provenance: {
        source: string;
        method: string;
        evidence: string[];
    };
    taint: AmpTaint;
    conflicts_with?: string[];
}

export interface AmpEffect {
    kind: AmpEffectKind;
    scope: string;
    reversible: boolean;
    window?: string;
    receipt: boolean;
}

export interface AmpAffordance {
    id: string;
    title: string;
    intent: string;
    level: AmpLevel;
    effects: AmpEffect[];
    preconditions: string[];
    permissions: string[];
    cost: AmpCost;
    verification: {
        method: string;
    };
}

export interface AmpProcessStep {
    id: string;
    title: string;
    affordance: string;
    requires?: string[];
}

export interface AmpProcess {
    id: string;
    title: string;
    steps: AmpProcessStep[];
}

export interface AmpManifestView {
    id: string;
    version: number;
    digest: string;
    issued_at: string;
    valid_until: string;
    claims: AmpClaim[];
    affordances: AmpAffordance[];
    process: AmpProcess;
}

export interface AmpValuesView {
    digest: string;
    weights: {
        value: AmpBudget;
        cost: AmpBudget;
    };
    caps: AmpBudget;
    approval: {
        effects: AmpEffectKind[];
    };
}

export interface AmpLeaseView {
    id: string;
    subject: string;
    scope: string[];
    ops: AmpVerb[];
    budget: AmpBudget;
    issued_at: string;
    expires: string;
}

export interface AmpCaseView {
    id: string;
    process: string;
    state: AmpCaseState;
    stepIndex: number;
    grants: string[];
}

export interface AmpLedgerEntry {
    seq: number;
    ts: string;
    verb: AmpVerb;
    object: string;
    ref: string;
    event: string;
    cost: AmpCost;
    prev_hash: string;
    hash: string;
}

export interface AmpHandleView {
    id: string;
    taint: AmpTaint;
    media: string;
    size: number;
    created_at: string;
}

export interface AmpGrantView {
    id: string;
    handle: string;
    caseId: string;
    step: string;
    expires: string;
}

export interface AmpScoreComponents {
    V: number;
    C: number;
    relevance: number;
    trust: number;
    fresh: number;
    diversity: number;
}

export interface AmpSliceItem {
    kind: "claim" | "affordance";
    id: string;
    level: AmpLevel;
    line: string;
    value: number;
    components: AmpScoreComponents;
}

export interface AmpWhyNot {
    id: string;
    reason: string;
}

export interface AmpSelfIdentity {
    model_id: string;
    runtime_version: string;
    principal: string;
    values_digest: string;
    manifest_digest: string;
    lease_id: string;
    issued_at: string;
}

export interface AmpSelfReliability {
    prior: AmpBetaPrior;
    posterior: AmpBetaPosterior;
}

export interface AmpSelfCapability {
    affordance: string;
    label: string;
    verified: boolean;
    verification: "receipt" | "test" | "declared" | "none";
    last_receipt?: string;
    confidence: number;
    belief: AmpBelief;
    evidence: string[];
    reliability: AmpSelfReliability;
    available_now: boolean;
    reason_unavailable?: string;
}

export interface AmpSelfPermissions {
    may: string[];
    must_not: string[];
    requires_approval: string[];
    boundaries: string[];
}

export interface AmpSelfAttention {
    intent: string;
    budget: AmpBudget;
    used: AmpBudget;
    context_utilization: number;
    slice_size: number;
    lease_expires: string;
}

export interface AmpSelfCalibration {
    brier: number | null;
    ece: number | null;
    auc: number | null;
    n: number;
    by_domain: Record<string, { brier: number; ece: number; n: number }>;
}

export interface AmpKnownUnknown {
    id: string;
    question: string;
    voi: number;
    evidence_needed: string[];
    blocking: boolean;
}

export interface AmpFailureMode {
    id: string;
    mode: string;
    count: number;
    last_seen: string;
    mitigation: string;
}

export interface AmpSelfView {
    subject: string;
    self_digest: string;
    identity: AmpSelfIdentity;
    claims: AmpClaim[];
    evidence: AmpEvidence[];
    capabilities: AmpSelfCapability[];
    permissions: AmpSelfPermissions;
    attention: AmpSelfAttention;
    calibration: AmpSelfCalibration;
    known_unknowns: AmpKnownUnknown[];
    failure_modes: AmpFailureMode[];
    last_receipts: string[];
    ledger_cursor: number;
    horizon: string[];
}

export interface AmpDeclareRequest {
    manifest: AmpManifestView;
    values: AmpValuesView;
}


export interface AmpError {
    code: string;
    message: string;
}

export interface AmpSnapshot {
    world: AmpManifestView;
    values: AmpValuesView;
    lease: AmpLeaseView;
    case: AmpCaseView;
    ledger: AmpLedgerEntry[];
    budget: {
        used: AmpBudget;
        caps: AmpBudget;
    };
    handles: AmpHandleView[];
    grants: AmpGrantView[];
    slice: AmpSliceItem[];
    whyNot: AmpWhyNot[];
    self?: AmpSelfView;
    latestHandle?: string;
    notice: string;
}

export interface AmpActRequest {
    affordance: string;
    args?: Record<string, unknown>;
    effectsAck: string[];
    approval?: string;
}

export interface AmpResolveRequest {
    handle: string;
    projection: "summary" | "rows" | "fields";
    maxTokens?: number;
}

export interface AmpAccountRequest {
    ref: string;
    outcome: AmpOutcome;
    note?: string;
}

export interface AmpReceipt {
    effect: AmpEffectKind;
    scope: string;
    status: "applied" | "partial" | "failed";
    applied_at: string;
    evidence: string;
}

export interface AmpActData {
    handle: string;
    receipt: AmpReceipt;
}

export interface AmpResolveData {
    handle: string;
    projection: string;
    data: unknown;
    lineage: string[];
    taint: AmpTaint;
    cost: AmpCost;
}

export interface AmpAccountData {
    balance: AmpBudget;
    entries: number;
}

export interface AmpResponse {
    ok: boolean;
    snapshot: AmpSnapshot;
    error?: AmpError;
    data?: unknown;
}

export interface AmpEngineApi {
    init: () => Promise<AmpResponse>;
    attend: (intent: string, level: AmpLevel) => Promise<AmpResponse>;
    act: (request: AmpActRequest) => Promise<AmpResponse>;
    resolve: (request: AmpResolveRequest) => Promise<AmpResponse>;
    account: (request: AmpAccountRequest) => Promise<AmpResponse>;
}
