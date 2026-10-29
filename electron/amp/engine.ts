/**
 * AMP host engine.
 *
 * The engine is a thin host adapter: canonical JSON, SHA-256 digests, Ed25519
 * signatures, Bayesian belief, attention salience/selection, six-axis budget
 * metering, boundary checks, policy gates, handles, receipts and the
 * hash-chained ledger all come from the vendored reference implementation in
 * `electron/protocol/amp`. This file only wires those modules into the
 * Electron-facing contract declared in `./types`.
 */
import type { CalibrationPoint } from "../protocol/amp/bayes/calibration.ts";
import { brier, ece } from "../protocol/amp/bayes/calibration.ts";
import type { BetaBelief, Evidence as BayesEvidence, Posterior } from "../protocol/amp/bayes/engine.ts";
import { betaMean, posteriorOf } from "../protocol/amp/bayes/engine.ts";
import type { ReliabilityBelief } from "../protocol/amp/bayes/reliability.ts";
import { SourceReliability } from "../protocol/amp/bayes/reliability.ts";
import type { Candidate, Selection } from "../protocol/amp/attention/attention.ts";
import { selectFocus } from "../protocol/amp/attention/attention.ts";
import { Dispatcher } from "../protocol/amp/attention/budget.ts";
import type { AttentionPlan, ProcessAttention } from "../protocol/amp/attention/resource.ts";
import {
    DefaultAttentionPolicy,
    attentionHealth,
    planAttention,
    processAttention,
    qualityAdjustedThroughput,
} from "../protocol/amp/attention/resource.ts";
import type { FrameDraft } from "../protocol/amp/boundary/frame.ts";
import { frameFrom } from "../protocol/amp/boundary/frame.ts";
import { RefTable } from "../protocol/amp/boundary/refTable.ts";
import type { ParsedToolCall, ToolSchema } from "../protocol/amp/boundary/toolCall.ts";
import { parseToolCall } from "../protocol/amp/boundary/toolCall.ts";
import { BoundaryRejection } from "../protocol/amp/error/boundaryRejection.ts";
import { EvidenceGraph } from "../protocol/amp/evidence/evidenceGraph.ts";
import { HandleStore } from "../protocol/amp/execution/handles.ts";
import type { Frame, FrameMode, Ignored, Slot } from "../protocol/amp/frame/frame.ts";
import type { GoalLifecycle } from "../protocol/amp/goal/goal.ts";
import { createGoalLifecycle, transitionGoal } from "../protocol/amp/goal/goal.ts";
import type { Goal, Plan, PlanTask } from "../protocol/amp/goal/plan.ts";
import { validatePlanInput } from "../protocol/amp/goal/plan.ts";
import type { LedgerCheckpoint } from "../protocol/amp/ledger/checkpoint.ts";
import { sealCheckpoint } from "../protocol/amp/ledger/checkpoint.ts";
import { Ledger } from "../protocol/amp/ledger/ledger.ts";
import type { ChainEntry, LedgerSnapshot, RestoredLedger } from "../protocol/amp/ledger/persistence.ts";
import { exportLedger, restoreLedger, verifySnapshot } from "../protocol/amp/ledger/persistence.ts";
import { Keyring, checkManifestWindow } from "../protocol/amp/manifest/keys.ts";
import type { Manifest } from "../protocol/amp/manifest/manifest.ts";
import type { KeyPair } from "../protocol/amp/manifest/sign.ts";
import { contentDigest, generateSigningKey, signManifest, verifyManifest } from "../protocol/amp/manifest/sign.ts";
import { PolicyEngine } from "../protocol/amp/policy/policy.ts";
import type { ActionRequest, EffectClass, PolicyVerdict } from "../protocol/amp/policy/policy.ts";
import { CircuitOpen, CostCeilingExceeded, Guard, RateLimited } from "../protocol/amp/policy/guard.ts";
import type { AmpEvent, Receipt } from "../protocol/amp/receipt/receipt.ts";
import { canonical, digestOf } from "../protocol/amp/semantic/canonical.ts";
import type { Criterion, Handle, Ref, Tier, Trust, Usage } from "../protocol/amp/types/common.ts";
import type { Claim, CausalClaim, EvidenceItem, UnknownItem } from "../protocol/amp/warrant/epistemic.ts";
import { deriveConfidence, validateClaim } from "../protocol/amp/warrant/warrant.ts";
import type {
    AmpAccountData,
    AmpAccountRequest,
    AmpActData,
    AmpActRequest,
    AmpAffordance,
    AmpBelief,
    AmpBetaPosterior,
    AmpBetaPrior,
    AmpBudget,
    AmpCaseState,
    AmpCaseView,
    AmpClaim,
    AmpCost,
    AmpEffect,
    AmpEffectKind,
    AmpEngineApi,
    AmpError,
    AmpEvidence,
    AmpFrameView,
    AmpGrantView,
    AmpHandleView,
    AmpImpactView,
    AmpKnownUnknown,
    AmpLedgerCheckpoint,
    AmpLedgerEntry,
    AmpLeaseView,
    AmpLevel,
    AmpLikelihood,
    AmpLikelihoodContribution,
    AmpManifestView,
    AmpProcess,
    AmpProcessStep,
    AmpReceipt,
    AmpResolveData,
    AmpResolveRequest,
    AmpResponse,
    AmpScoreComponents,
    AmpScoreInputs,
    AmpSelfAttention,
    AmpSelfCalibration,
    AmpSelfCapability,
    AmpSelfView,
    AmpSliceItem,
    AmpSnapshot,
    AmpTaint,
    AmpValuesView,
    AmpVerb,
    AmpWhyNot,
} from "./types";

type WorldPayload = Omit<AmpManifestView, "digest" | "signatures" | "public_key">;

type AmpBudgetAxis = "tokens" | "time_ms" | "space_bytes" | "capability_load" | "usd" | "compute_ms" | "energy_wh" | "human_items" | "risk";

type LedgerPayload = {
    ts: string;
    verb: AmpVerb;
    object: string;
    ref: string;
    event: string;
    cost: AmpCost;
};

type ParseOutcome =
    | { ok: true; parsed: ParsedToolCall }
    | { ok: false; code: string; message: string };

interface AxisMeter {
    axis: AmpBudgetAxis;
    dispatcher: Dispatcher;
}

interface HandleRecord {
    handle: Handle;
    payload: unknown;
    taint: AmpTaint;
    media: string;
    lineage: string[];
    created_at: string;
    expires: string;
}

interface CapabilityRecord {
    id: string;
    prior: number;
    evidence: EvidenceItem[];
    receipts: string[];
    successes: number;
    failures: number;
}

interface CandidateMeta {
    kind: "claim" | "affordance";
    id: string;
    candidate: Candidate;
    inputs: AmpScoreInputs;
    components: AmpScoreComponents;
    line: string;
}

interface ClaimSeedEvidence {
    id: string;
    kind: EvidenceItem["kind"];
    trust: Trust;
    independence: number;
    relation: "supports" | "undercuts" | "contradicts";
    entails: boolean;
    origin: string;
}

interface ClaimSeed {
    id: string;
    statement: string;
    subject: string;
    relation: string;
    value: unknown;
    tier: Tier;
    baseRate: number;
    priorSource: string;
    evidence: ClaimSeedEvidence[];
    conflictsWith?: string[];
    causal?: CausalClaim;
}

interface SelfAttentionPermissions {
    may: string[];
    must_not: string[];
    requires_approval: string[];
    boundaries: string[];
}

const WORLD_ID: string = "amp://world/periodicity/calendar-import";
const PROCESS_ID: string = "p:calendar-import";
const SUBJECT: string = "agent:workflow-console";
const SELF_ID: string = "amp://self/agent:workflow-console";
const CASE_ID: string = "case:calendar-2026-01";
const PRIMARY_SCOPE: string = "dataset:2026";
const ROLES: readonly string[] = ["role:analyst", "role:approver"];
const KID: string = "dev-2026-10";
const TENANT: string = "periodicity";
const AGENT_REF_ID: string = normalizeId(SELF_ID);

const ATTENTION_LEVELS: readonly AmpLevel[] = ["L0", "L1", "L2"];
const PROJECTIONS: readonly string[] = ["summary", "rows", "fields"];
const OUTCOMES: readonly string[] = ["success", "failure", "unknown"];

const BUDGET_AXES: readonly AmpBudgetAxis[] = [
    "tokens",
    "time_ms",
    "space_bytes",
    "capability_load",
    "usd",
    "compute_ms",
    "energy_wh",
    "human_items",
    "risk",
];

/**
 * Copies a canonical AMP identifier into the reference id grammar.
 * @param display The host-facing identifier.
 * @return A lowercase id that satisfies the reference `isId` grammar.
 */
function normalizeId(display: string): string {
    const sanitized: string = display.toLowerCase().replace(/[^a-z0-9._:-]/g, "-").slice(0, 64);
    return /^[a-z]/.test(sanitized) ? sanitized : `x${sanitized}`.slice(0, 64);
}

/**
 * Builds the ledger-style key of one declared effect.
 * @param effect The declared affordance effect.
 * @return The `kind:scope` acknowledgement key.
 */
function effectKey(effect: AmpEffect): string {
    return `${effect.kind}:${effect.scope}`;
}

/**
 * Maps the reference effect taxonomy from the host effect vocabulary.
 * @param kind The host effect kind.
 * @param reversible Whether the effect can be rolled back.
 * @return The reference policy effect class.
 */
function effectClassOfKind(kind: AmpEffectKind, reversible: boolean): EffectClass {
    if (kind === "read") {
        return "read";
    }
    if (kind === "write") {
        return reversible ? "write-reversible" : "write-irreversible";
    }
    if (kind === "network") {
        return "send";
    }
    if (kind === "spend") {
        return "spend";
    }
    if (kind === "irreversible") {
        return "publish";
    }
    if (kind === "grant") {
        return "permission";
    }
    return "write-reversible";
}

/**
 * Returns the effect class of the first declared effect of an affordance.
 * @param affordance The affordance whose execution is being requested.
 * @return The policy effect class bound to the request.
 */
function effectClassOf(affordance: AmpAffordance): EffectClass {
    const effect: AmpEffect | undefined = affordance.effects[0];
    if (effect === (void 0)) {
        return "read";
    }
    return effectClassOfKind(effect.kind, effect.reversible);
}

/**
 * Maps a reference trust tier onto the host taint vocabulary.
 * @param trust The reference trust tier.
 * @return The host taint label.
 */
function taintOfTrust(trust: Trust): AmpTaint {
    if (trust === "external") {
        return "untrusted";
    }
    if (trust === "asserted" || trust === "inferred") {
        return "mixed";
    }
    return "trusted";
}

/**
 * Narrows a number into the closed unit interval.
 * @param value The number to clamp.
 * @return The clamped number.
 */
function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * Converts a probability into log odds for the belief view.
 * @param probability The probability in [0, 1].
 * @return The clamped log odds.
 */
function logit(probability: number): number {
    const clamped: number = Math.min(0.999999, Math.max(0.000001, probability));
    return Math.log(clamped / (1 - clamped));
}

/**
 * Builds a weak Beta prior from a base rate.
 * @param mean The prior mean.
 * @param kappa The prior strength.
 * @return The Beta prior consumed by the reference posterior.
 */
function betaPriorOf(mean: number, kappa: number): BetaBelief {
    const clamped: number = clamp01(mean);
    return { alpha: clamped * kappa, beta: (1 - clamped) * kappa };
}

/**
 * Converts a reference epistemic evidence item into a Bayesian evidence item.
 * @param item The reference evidence item.
 * @return The evidence consumed by the reference posterior.
 */
function toBayesEvidence(item: EvidenceItem): BayesEvidence {
    const relation: "supports" | "undercuts" | "contradicts" = item.relation ?? "supports";
    const independence: number = clamp01(item.independence);
    const supports: number = relation === "supports" ? independence : 0;
    const weakens: number = relation === "contradicts" ? independence : relation === "undercuts" ? 0.5 * independence : 0;
    return {
        dimension: "correctness",
        positive: supports,
        negative: weakens,
        reliability: independence,
        source: item.origin ?? item.id,
        note: item.id,
    };
}

/**
 * Projects a reference evidence item onto the host evidence view.
 * @param item The reference evidence item.
 * @param reliability The learned source reliability table.
 * @param updatedAt The timestamp used for the calibration row.
 * @return The host evidence view.
 */
function evidenceView(item: EvidenceItem, reliability: SourceReliability, updatedAt: string): AmpEvidence {
    const relation: "supports" | "undercuts" | "contradicts" = item.relation ?? "supports";
    const independence: number = clamp01(item.independence);
    const sensitivity: number = Math.max(0.01, independence);
    const falsePositive: number = Math.max(0.01, 1 - independence);
    const likelihood: AmpLikelihood = {
        model: "binary",
        sensitivity,
        false_positive_rate: falsePositive,
        lr_plus: sensitivity / falsePositive,
        lr_minus: (1 - sensitivity) / (1 - falsePositive),
    };
    const view: AmpEvidence = {
        id: item.id,
        source: item.origin ?? item.id,
        method: item.kind,
        observed_at: item.at,
        taint: taintOfTrust(item.trust),
        outcome: relation === "supports" ? "positive" : "negative",
        likelihood,
        depends_on: [],
        cluster: item.origin ?? item.id,
        weight: independence,
    };
    const snapshot: Record<string, ReliabilityBelief> = reliability.snapshot();
    const belief: ReliabilityBelief | undefined = snapshot[item.origin ?? item.id];
    if (belief !== (void 0)) {
        view.calibration = { n: belief.observations, updated_at: updatedAt };
    }
    return view;
}

/**
 * Returns the cost weight the reference salience function divides by.
 * @param inputs The attention candidate inputs.
 * @return The cost factor, always at least one.
 */
function costFactorOf(inputs: AmpScoreInputs): number {
    return 1 + 2 * clamp01(inputs.costTokens / 2000) + 3 * clamp01(inputs.risk);
}

/**
 * Returns the token cost of a slice candidate line.
 * @param text The line rendered into the slice.
 * @return The estimated token cost.
 */
function tokenCostOf(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Returns the attention cap associated with one disclosure level.
 * @param level The requested attention level.
 * @return The maximum number of slice items.
 */
function sliceCapFor(level: AmpLevel): number {
    if (level === "L0") {
        return 3;
    }
    if (level === "L1") {
        return 6;
    }
    return 8;
}

/**
 * Returns the frame mode associated with one disclosure level.
 * @param level The requested attention level.
 * @return The frame mode used for the attention frame.
 */
function frameModeFor(level: AmpLevel): FrameMode {
    if (level === "L0") {
        return "triage";
    }
    if (level === "L1") {
        return "explore";
    }
    return "exploit";
}

/**
 * Builds a timestamp that lies a number of milliseconds in the future.
 * @param milliseconds The offset in milliseconds.
 * @return The ISO-8601 timestamp.
 */
function isoAfter(milliseconds: number): string {
    return new Date(Date.now() + milliseconds).toISOString();
}

/**
 * Returns the limit of one budget axis.
 * @param budget The capability budget.
 * @param axis The queried axis.
 * @return The axis limit.
 */
function axisLimitOf(budget: AmpBudget, axis: AmpBudgetAxis): number {
    if (axis === "tokens") {
        return budget.tokens;
    }
    if (axis === "time_ms") {
        return budget.time_ms;
    }
    if (axis === "space_bytes") {
        return budget.space_bytes;
    }
    if (axis === "capability_load") {
        return budget.capability_load;
    }
    if (axis === "usd") {
        return Number(budget.resources.usd);
    }
    if (axis === "compute_ms") {
        return budget.resources.compute_ms;
    }
    if (axis === "energy_wh") {
        return budget.resources.energy_wh;
    }
    if (axis === "human_items") {
        return budget.resources.human_items;
    }
    return budget.risk;
}

/**
 * Returns the amount one cost charges against a budget axis.
 * @param cost The charged cost.
 * @param axis The charged axis.
 * @return The axis amount.
 */
function axisAmountOf(cost: AmpCost, axis: AmpBudgetAxis): number {
    if (axis === "tokens") {
        return cost.tokens;
    }
    if (axis === "time_ms") {
        return cost.time_ms;
    }
    if (axis === "space_bytes") {
        return cost.space_bytes;
    }
    if (axis === "capability_load") {
        return cost.capability_load;
    }
    if (axis === "usd") {
        return Number(cost.resources.usd);
    }
    if (axis === "compute_ms") {
        return cost.resources.compute_ms;
    }
    if (axis === "energy_wh") {
        return cost.resources.energy_wh;
    }
    if (axis === "human_items") {
        return cost.resources.human_items;
    }
    return cost.risk;
}

/**
 * Builds the zero cost used by bookkeeping-only ledger entries.
 * @return A zero cost value.
 */
function zeroCost(): AmpCost {
    return {
        tokens: 0,
        time_ms: 0,
        space_bytes: 0,
        capability_load: 0,
        resources: { usd: "0", compute_ms: 0, energy_wh: 0, human_items: 0 },
        risk: 0,
    };
}

/**
 * Builds a cost value from its six-axis components.
 * @param tokens The charged tokens.
 * @param timeMs The charged milliseconds.
 * @param spaceBytes The charged bytes.
 * @param capabilityLoad The charged capability slots.
 * @param risk The charged risk.
 * @param humanItems The charged human items.
 * @return The cost value.
 */
function makeCost(tokens: number, timeMs: number, spaceBytes: number, capabilityLoad: number, risk: number, humanItems: number = 0): AmpCost {
    return {
        tokens,
        time_ms: timeMs,
        space_bytes: spaceBytes,
        capability_load: capabilityLoad,
        resources: { usd: "0", compute_ms: timeMs, energy_wh: 0, human_items: humanItems },
        risk,
    };
}

/**
 * Copies a budget value so callers cannot mutate engine state.
 * @param budget The value to copy.
 * @return A detached copy.
 */
function copyBudget(budget: AmpBudget): AmpBudget {
    return {
        tokens: budget.tokens,
        time_ms: budget.time_ms,
        space_bytes: budget.space_bytes,
        capability_load: budget.capability_load,
        resources: {
            usd: budget.resources.usd,
            compute_ms: budget.resources.compute_ms,
            energy_wh: budget.resources.energy_wh,
            human_items: budget.resources.human_items,
        },
        risk: budget.risk,
    };
}

/**
 * Copies a cost value so callers cannot mutate engine state.
 * @param cost The cost to copy.
 * @return A detached copy.
 */
function copyCost(cost: AmpCost): AmpCost {
    return copyBudget(cost);
}

/**
 * Converts a cost into the reference usage shape used by receipts.
 * @param cost The cost to convert.
 * @return The reference usage value.
 */
function usageOf(cost: AmpCost): Usage {
    return { tokens: cost.tokens, ms: cost.time_ms, calls: cost.capability_load, money: Number(cost.resources.usd) };
}

/**
 * Converts reference usage back into a cost for ledger projection.
 * @param usage The reference usage value.
 * @return The projected cost.
 */
function costOfUsage(usage: Usage): AmpCost {
    return {
        tokens: usage.tokens ?? 0,
        time_ms: usage.ms ?? 0,
        space_bytes: 0,
        capability_load: usage.calls ?? 0,
        resources: { usd: (usage.money ?? 0).toFixed(2), compute_ms: 0, energy_wh: 0, human_items: 0 },
        risk: 0,
    };
}

/**
 * Shortens a digest for human-readable notices.
 * @param digest The digest to shorten.
 * @return The shortened digest.
 */
function shortDigest(digest: string): string {
    return digest.length > 20 ? `${digest.slice(0, 11)}...${digest.slice(-8)}` : digest;
}

/**
 * Returns a keyword relevance estimate for one attention candidate.
 * @param text The candidate text.
 * @param intent The current intent.
 * @return The relevance in [0, 1].
 */
function relevanceOf(text: string, intent: string): number {
    const keywords: readonly string[] = ["导入", "历法", "数据", "校验", "发布", "读取", "行数", "schema"];
    const matches: number = keywords.filter((keyword: string): boolean => {
        return intent.includes(keyword) || text.includes(keyword);
    }).length;
    return clamp01(0.35 + matches * 0.12);
}

/**
 * Projects a stored payload for a resolve projection.
 * @param content The stored payload.
 * @param projection The requested projection.
 * @return The projected payload.
 */
function projectPayload(content: unknown, projection: string): unknown {
    if (projection === "rows") {
        return content;
    }
    if (content === null || typeof content !== "object" || Array.isArray(content)) {
        return content;
    }
    const record: Record<string, unknown> = content as Record<string, unknown>;
    const keys: string[] = Object.keys(record);
    if (projection === "fields") {
        const fields: Record<string, unknown> = {};
        for (const key of keys.slice(0, 6)) {
            fields[key] = record[key];
        }
        return fields;
    }
    const summary: Record<string, unknown> = {};
    for (const key of keys) {
        const value: unknown = record[key];
        if (Array.isArray(value)) {
            summary[key] = { count: value.length, first: value[0] };
        } else if (typeof value === "string" && value.length > 120) {
            summary[key] = `${value.slice(0, 117)}...`;
        } else {
            summary[key] = value;
        }
    }
    return summary;
}

/**
 * Rounds a probability to three decimals for stable views.
 * @param value The probability to round.
 * @return The rounded probability.
 */
function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * Host engine that exposes the AMP five verbs to the Electron main process.
 */
export class AmpEngine implements AmpEngineApi {
    private signingKey: KeyPair | null = null;
    private publicJwk: JsonWebKey | undefined = (void 0);
    private world: AmpManifestView | null = null;
    private values: AmpValuesView | null = null;
    private lease: AmpLeaseView | null = null;
    private caps: AmpBudget | null = null;
    private process: AmpProcess | null = null;
    private affordances: AmpAffordance[] = [];
    private claims: Claim[] = [];
    private unknowns: UnknownItem[] = [];
    private evidenceGraph: EvidenceGraph | null = null;
    private lifecycle: GoalLifecycle | null = null;
    private plan: Plan | null = null;
    private ledger: Ledger = new Ledger();
    private checkpoint: LedgerCheckpoint | undefined = (void 0);
    private handleStore: HandleStore | null = null;
    private handleRecords: Map<string, HandleRecord> = new Map<string, HandleRecord>();
    private grants: Map<string, AmpGrantView> = new Map<string, AmpGrantView>();
    private grantApprovals: Map<string, string> = new Map<string, string>();
    private caseGrants: string[] = [];
    private capabilities: Map<string, CapabilityRecord> = new Map<string, CapabilityRecord>();
    private reliability: SourceReliability | null = null;
    private policy: PolicyEngine | null = null;
    private guard: Guard | null = null;
    private meters: AxisMeter[] = [];
    private slice: AmpSliceItem[] = [];
    private whyNot: AmpWhyNot[] = [];
    private frameView: AmpFrameView | undefined = (void 0);
    private frameCycle: number = 0;
    private impact: AmpImpactView | undefined = (void 0);
    private latestHandle: string | undefined = (void 0);
    private notice: string = "";
    private intent: string = "";
    private lastLevel: AmpLevel = "L1";
    private worldIssued: string = "";
    private worldValidUntil: string = "";
    private worldVersion: number = 1;
    private stepIndex: number = 0;
    private caseState: AmpCaseState = "open";
    private requestSeq: number = 0;
    private receiptSeq: number = 0;
    private calibrationPoints: CalibrationPoint[] = [];

    /**
     * Declares the signed world, mints the lease and builds the first slice.
     * @return A response carrying the declared world snapshot.
     */
    public async init(): Promise<AmpResponse> {
        this.reset();
        const now: string = new Date().toISOString();
        const validUntil: string = isoAfter(60 * 60 * 1000);
        const leaseExpires: string = isoAfter(15 * 60 * 1000);
        this.worldIssued = now;
        this.worldValidUntil = validUntil;
        this.worldVersion = 1;

        const signingKey: KeyPair = await generateSigningKey(KID);
        this.signingKey = signingKey;
        this.publicJwk = await crypto.subtle.exportKey("jwk", signingKey.publicKey);
        const keyring: Keyring = new Keyring({ clockSkewMs: 0 });
        keyring.add({ kid: KID, publicKey: signingKey.publicKey, status: "active", validFrom: now, validTo: leaseExpires });
        const keyWindow: { ok: boolean; reasons: string[] } = keyring.verifyWindow(KID, now);
        if (!keyWindow.ok) {
            throw new Error(`signing key window is invalid: ${keyWindow.reasons.join("; ")}`);
        }
        const windowVerdict: { ok: boolean; reasons: string[] } = checkManifestWindow({ issued: now, expires: validUntil }, now);
        if (!windowVerdict.ok) {
            throw new Error(`manifest window is invalid: ${windowVerdict.reasons.join("; ")}`);
        }

        this.caps = this.createCaps();
        this.affordances = this.createAffordances();
        this.process = this.createProcess();
        this.claims = this.createInitialClaims(now, validUntil);
        this.evidenceGraph = this.buildEvidenceGraph(this.claims);
        this.unknowns = this.createInitialUnknowns(now);
        this.lifecycle = this.createCaseGoal(now);
        this.plan = this.createPlan(now);
        const planProblems: string[] = validatePlanInput({ tasks: this.plan.tasks, edges: this.plan.edges, abandonIf: this.plan.abandon_if });
        if (planProblems.length > 0) {
            throw new Error(`calendar plan is not valid: ${planProblems.join("; ")}`);
        }

        this.values = this.createValues();
        this.lease = {
            id: "l:calendar-import-2026",
            subject: SUBJECT,
            scope: [WORLD_ID, PRIMARY_SCOPE],
            ops: ["declare", "attend", "act", "resolve", "account"],
            budget: copyBudget(this.caps),
            issued_at: now,
            expires: leaseExpires,
        };
        this.meters = this.createMeters(this.caps);
        this.policy = new PolicyEngine({
            now: (): string => {
                return new Date().toISOString();
            },
            approvalEffects: this.approvalClasses(),
            allowReadWithoutClaim: true,
        });
        this.guard = new Guard({
            rate: { limit: 60, intervalMs: 60 * 1000 },
            breaker: { failures: 5, cooldownMs: 30 * 1000 },
            costCeiling: Number(this.caps.resources.usd),
        });
        this.handleStore = new HandleStore();
        this.reliability = new SourceReliability();
        for (const affordance of this.affordances) {
            this.capabilityState(affordance.id);
        }

        this.world = await this.signWorld();
        this.stepIndex = 0;
        this.caseState = "open";
        this.intent = "准备导入 2026 年历法数据，检查行数与 schema";
        this.lastLevel = "L1";
        this.refreshSlice();
        await this.appendLedger("declare", WORLD_ID, "manifest_declared", zeroCost());
        this.notice = "世界已声明；初始注意力切片已生成；等待第一次 act。";
        return this.respond(true, (void 0), (void 0));
    }

    /**
     * Rebuilds the attention slice for an intent and disclosure level.
     * @param intent The natural-language intent that drives relevance.
     * @param level The disclosure level (L0, L1 or L2).
     * @return A response carrying the refreshed slice and frame.
     */
    public async attend(intent: string, level: AmpLevel): Promise<AmpResponse> {
        if (!this.isReady()) {
            return this.init();
        }
        if (typeof intent !== "string" || intent.trim().length === 0) {
            return this.fail("SCHEMA_INVALID", "intent must be a non-empty string");
        }
        if (!ATTENTION_LEVELS.includes(level)) {
            return this.fail("SCHEMA_INVALID", `unsupported attention level: ${String(level)}`);
        }
        const cost: AmpCost = makeCost(180, 10, 1024, 0, 0.01);
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", `attention budget exceeded on ${this.exceededAxis(cost)}`);
        }
        this.charge(cost);
        this.intent = intent;
        this.lastLevel = level;
        this.refreshSlice();
        await this.appendLedger("attend", intent, "attention_slice", cost);
        this.notice = `注意力切片已更新：${String(this.slice.length)} 条，消耗 ${String(cost.tokens)} tokens。`;
        return this.respond(true, (void 0), (void 0));
    }

    /**
     * Executes the current process step after boundary, permission, lease,
     * budget, prediction and approval gates have all passed.
     * @param request The requested affordance, arguments, acknowledgements and approval.
     * @return A response carrying the handle and receipt of the executed effect.
     */
    public async act(request: AmpActRequest): Promise<AmpResponse> {
        if (!this.isReady()) {
            return this.init();
        }
        if (request === null || typeof request !== "object" || typeof request.affordance !== "string") {
            return this.fail("SCHEMA_INVALID", "affordance must be a non-empty string");
        }
        const step: AmpProcessStep | undefined = this.currentStep();
        if (step === (void 0)) {
            return this.fail("CASE_CLOSED", "the process case is already closed");
        }
        const affordance: AmpAffordance | undefined = this.findAffordance(request.affordance);
        if (affordance === (void 0)) {
            return this.fail("SCHEMA_INVALID", `unknown affordance: ${request.affordance}`);
        }
        if (affordance.id !== step.affordance) {
            return this.fail("GATE_NOT_READY", `expected ${step.affordance}, got ${affordance.id}`);
        }

        const parseOutcome: ParseOutcome = this.tryParseArgs(affordance, request.args);
        if (parseOutcome.ok === false) {
            return this.fail(parseOutcome.code, parseOutcome.message);
        }
        const parsed: ParsedToolCall = parseOutcome.parsed;

        const ackFailure: AmpError | undefined = this.checkEffectsAck(affordance, request.effectsAck);
        if (ackFailure !== (void 0)) {
            return this.fail(ackFailure.code, ackFailure.message);
        }

        const permitted: boolean = affordance.permissions.every((permission: string): boolean => {
            return ROLES.includes(permission);
        });
        if (!permitted) {
            return this.fail("PERMISSION_DENIED", "role intersection is empty");
        }
        const actionRequest: ActionRequest = this.actionRequestFor(affordance, parsed);
        const policyVerdict: PolicyVerdict = this.policy === null
            ? { outcome: "deny", reason: "policy_unavailable", minTier: "T4" }
            : this.policy.decide(actionRequest);
        if (policyVerdict.outcome === "deny") {
            return this.fail("PERMISSION_DENIED", `policy: ${policyVerdict.reason}`);
        }

        const leaseFailure: AmpError | undefined = this.checkLease(affordance);
        if (leaseFailure !== (void 0)) {
            return this.fail(leaseFailure.code, leaseFailure.message);
        }

        const cost: AmpCost = copyCost(affordance.cost);
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", `execution budget exceeded on ${this.exceededAxis(cost)}`);
        }
        if (this.guard !== null) {
            try {
                this.guard.beforeDispatch({ money: Number(cost.resources.usd) });
            } catch (error) {
                const failure: AmpError = this.controlFailure(error);
                return this.fail(failure.code, failure.message);
            }
        }

        const needsGrant: boolean = affordance.effects.some((effect: AmpEffect): boolean => {
            return effect.kind === "irreversible" || effect.kind === "spend";
        });
        const grant: AmpGrantView | undefined = this.grantForApproval(request.approval);
        if (needsGrant && (grant === (void 0) || !this.isGrantValid(grant))) {
            return this.fail("APPROVAL_REQUIRED", "a valid grant is required for this action");
        }
        const approvalId: string | undefined = grant === (void 0) ? (void 0) : this.grantApprovals.get(grant.handle);
        const finalVerdict: PolicyVerdict = this.policy === null
            ? { outcome: "deny", reason: "policy_unavailable", minTier: "T4" }
            : this.policy.decide(actionRequest, approvalId);
        if (finalVerdict.outcome !== "allow") {
            return this.fail("APPROVAL_REQUIRED", `policy: ${finalVerdict.reason}`);
        }

        this.charge(cost);
        const outcome: { handle: string; effect: AmpEffectKind } = await this.execute(affordance, parsed, grant);
        this.latestHandle = outcome.handle;
        this.recordReceipt(affordance, outcome.handle, cost);
        this.advanceCase(affordance.id);
        await this.appendLedger("act", affordance.id, `${affordance.id}_applied`, cost);
        this.notice = `${affordance.title} 已执行；receipt ${shortDigest(outcome.handle)}。`;

        const receipt: AmpReceipt = {
            effect: outcome.effect,
            scope: affordance.effects[0]?.scope ?? PRIMARY_SCOPE,
            status: "applied",
            applied_at: new Date().toISOString(),
            evidence: outcome.handle,
        };
        const data: AmpActData = { handle: outcome.handle, receipt };
        return this.respond(true, (void 0), data);
    }

    /**
     * Materializes a stored handle under one projection.
     * @param request The handle, projection and token ceiling.
     * @return A response carrying the projected data, lineage and cost.
     */
    public async resolve(request: AmpResolveRequest): Promise<AmpResponse> {
        if (!this.isReady()) {
            return this.init();
        }
        if (request === null || typeof request !== "object") {
            return this.fail("SCHEMA_INVALID", "resolve request must be an object");
        }
        const record: HandleRecord | undefined = this.handleRecords.get(request.handle);
        if (record === (void 0)) {
            return this.fail("SCHEMA_INVALID", `unknown handle: ${String(request.handle)}`);
        }
        if (Date.parse(record.expires) < Date.now()) {
            return this.fail("HANDLE_EXPIRED", "handle expired");
        }
        if (!PROJECTIONS.includes(request.projection)) {
            return this.fail("SCHEMA_INVALID", `unsupported projection: ${String(request.projection)}`);
        }
        if (this.handleStore === null) {
            return this.fail("SCHEMA_INVALID", "handle store is unavailable");
        }
        const maxTokens: number = Math.max(1, request.maxTokens ?? 4000);
        const page: { text: string; next: number | null; totalPages: number; tokens: number } = this.handleStore.read(record.handle.id, 0, maxTokens);
        if (page.next !== null) {
            return this.fail("BUDGET_EXCEEDED", `projection needs more than ${String(maxTokens)} tokens`);
        }
        const data: unknown = projectPayload(record.payload, request.projection);
        const cost: AmpCost = makeCost(page.tokens, 5, 2048, 0, 0);
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", `resolve budget exceeded on ${this.exceededAxis(cost)}`);
        }
        this.charge(cost);
        this.latestHandle = record.handle.id;
        this.recordHandleReceipt(record, cost, request.projection);
        await this.appendLedger("resolve", record.handle.id, `projection_${request.projection}`, cost);
        this.notice = `句柄已投影：${request.projection}，约 ${String(page.tokens)} tokens。`;
        const payload: AmpResolveData = {
            handle: record.handle.id,
            projection: request.projection,
            data,
            lineage: [...record.lineage],
            taint: record.taint,
            cost,
            page: { tokens: page.tokens, total_pages: page.totalPages, next: page.next },
        };
        return this.respond(true, (void 0), payload);
    }

    /**
     * Settles the case outcome and reports the six-axis balance.
     * @param request The settlement reference, outcome and optional note.
     * @return A response carrying the used budget and the ledger length.
     */
    public async account(request: AmpAccountRequest): Promise<AmpResponse> {
        if (!this.isReady()) {
            return this.init();
        }
        if (request === null || typeof request !== "object" || !OUTCOMES.includes(request.outcome)) {
            return this.fail("SCHEMA_INVALID", `unsupported outcome: ${String(request.outcome)}`);
        }
        const success: boolean = request.outcome === "success";
        if (this.reliability !== null) {
            this.reliability.observe("runtime:account", success);
        }
        if (!success && this.lifecycle !== null && this.lifecycle.state === "active") {
            this.lifecycle = transitionGoal(this.lifecycle, "abandoned", new Date().toISOString());
        }
        await this.appendLedger("account", request.ref, `outcome_${request.outcome}`, zeroCost());
        this.notice = `已结算 ${request.ref}：${request.outcome}。`;
        const data: AmpAccountData = {
            balance: this.usedBudget(),
            entries: this.chainSnapshot().entries.length,
        };
        return this.respond(true, (void 0), data);
    }

    /**
     * Re-verifies and replays the append-only ledger with the reference tooling.
     * @return The verification verdict plus the recorded and replayed tips.
     */
    public verifyLedger(): { ok: boolean; reasons: string[]; tip: string; count: number; replay_tip: string; replay_count: number; consistent: boolean } {
        const snapshot: LedgerSnapshot = this.chainSnapshot();
        const verdict: { ok: boolean; reasons: string[] } = verifySnapshot(snapshot);
        const restored: RestoredLedger = restoreLedger(snapshot);
        const rebuilt: Ledger = new Ledger();
        for (const event of restored.events) {
            rebuilt.appendEvent(event as AmpEvent);
        }
        for (const receipt of restored.receipts) {
            rebuilt.receipts.push(receipt as Receipt);
        }
        const replayed: LedgerSnapshot = exportLedger(rebuilt, AGENT_REF_ID);
        return {
            ok: verdict.ok,
            reasons: verdict.reasons,
            tip: snapshot.tip,
            count: snapshot.count,
            replay_tip: replayed.tip,
            replay_count: replayed.count,
            consistent: replayed.tip === snapshot.tip
                && replayed.count === snapshot.count
                && digestOf(replayed) === digestOf(snapshot),
        };
    }

    private reset(): void {
        this.signingKey = null;
        this.publicJwk = (void 0);
        this.world = null;
        this.values = null;
        this.lease = null;
        this.caps = null;
        this.process = null;
        this.affordances = [];
        this.claims = [];
        this.unknowns = [];
        this.evidenceGraph = null;
        this.lifecycle = null;
        this.plan = null;
        this.ledger = new Ledger();
        this.checkpoint = (void 0);
        this.handleStore = null;
        this.handleRecords = new Map<string, HandleRecord>();
        this.grants = new Map<string, AmpGrantView>();
        this.grantApprovals = new Map<string, string>();
        this.caseGrants = [];
        this.capabilities = new Map<string, CapabilityRecord>();
        this.reliability = null;
        this.policy = null;
        this.guard = null;
        this.meters = [];
        this.slice = [];
        this.whyNot = [];
        this.frameView = (void 0);
        this.frameCycle = 0;
        this.impact = (void 0);
        this.latestHandle = (void 0);
        this.notice = "";
        this.intent = "";
        this.lastLevel = "L1";
        this.worldIssued = "";
        this.worldValidUntil = "";
        this.worldVersion = 1;
        this.stepIndex = 0;
        this.caseState = "open";
        this.requestSeq = 0;
        this.receiptSeq = 0;
        this.calibrationPoints = [];
    }

    private isReady(): boolean {
        return this.world !== null
            && this.values !== null
            && this.lease !== null
            && this.caps !== null
            && this.process !== null
            && this.policy !== null
            && this.guard !== null
            && this.handleStore !== null
            && this.reliability !== null;
    }

    private createCaps(): AmpBudget {
        return {
            tokens: 20000,
            time_ms: 60000,
            space_bytes: 1048576,
            capability_load: 10,
            resources: { usd: "0.02", compute_ms: 5000, energy_wh: 1, human_items: 5 },
            risk: 0.9,
        };
    }

    private createValues(): AmpValuesView {
        if (this.caps === null) {
            throw new Error("caps must exist before values");
        }
        const weights: AmpBudget = {
            tokens: 1,
            time_ms: 1,
            space_bytes: 1,
            capability_load: 1,
            resources: { usd: "1", compute_ms: 1, energy_wh: 1, human_items: 1 },
            risk: 1,
        };
        const approval: { effects: AmpEffectKind[] } = { effects: ["irreversible", "spend"] };
        const weightsView: { value: AmpBudget; cost: AmpBudget } = { value: weights, cost: weights };
        const digest: string = digestOf({ weights: weightsView, caps: this.caps, approval });
        return { digest, weights: weightsView, caps: copyBudget(this.caps), approval };
    }

    private approvalClasses(): ReadonlySet<EffectClass> {
        if (this.values === null) {
            return new Set<EffectClass>(["publish", "spend"]);
        }
        const classes: EffectClass[] = this.values.approval.effects.map((kind: AmpEffectKind): EffectClass => {
            return effectClassOfKind(kind, true);
        });
        return new Set<EffectClass>(classes);
    }

    private createMeters(caps: AmpBudget): AxisMeter[] {
        return BUDGET_AXES.map((axis: AmpBudgetAxis): AxisMeter => {
            return { axis, dispatcher: new Dispatcher({ tokens: axisLimitOf(caps, axis) }) };
        });
    }

    private meterOf(axis: AmpBudgetAxis): AxisMeter | undefined {
        return this.meters.find((meter: AxisMeter): boolean => {
            return meter.axis === axis;
        });
    }

    private axisUsed(axis: AmpBudgetAxis): number {
        const meter: AxisMeter | undefined = this.meterOf(axis);
        if (meter === (void 0)) {
            return 0;
        }
        return meter.dispatcher.usage().tokens ?? 0;
    }

    private axisRemaining(axis: AmpBudgetAxis): number {
        const meter: AxisMeter | undefined = this.meterOf(axis);
        if (meter === (void 0)) {
            return 0;
        }
        return meter.dispatcher.remaining().tokens;
    }

    private usedBudget(): AmpBudget {
        return {
            tokens: this.axisUsed("tokens"),
            time_ms: this.axisUsed("time_ms"),
            space_bytes: this.axisUsed("space_bytes"),
            capability_load: this.axisUsed("capability_load"),
            resources: {
                usd: this.axisUsed("usd").toFixed(2),
                compute_ms: this.axisUsed("compute_ms"),
                energy_wh: this.axisUsed("energy_wh"),
                human_items: this.axisUsed("human_items"),
            },
            risk: this.axisUsed("risk"),
        };
    }

    private fitsBudget(cost: AmpCost): boolean {
        for (const axis of BUDGET_AXES) {
            if (axisAmountOf(cost, axis) > this.axisRemaining(axis) + 1e-9) {
                return false;
            }
        }
        return true;
    }

    private exceededAxis(cost: AmpCost): string {
        for (const axis of BUDGET_AXES) {
            if (axisAmountOf(cost, axis) > this.axisRemaining(axis) + 1e-9) {
                return axis;
            }
        }
        return "tokens";
    }

    private charge(cost: AmpCost): void {
        for (const axis of BUDGET_AXES) {
            const amount: number = axisAmountOf(cost, axis);
            if (amount === 0) {
                continue;
            }
            const meter: AxisMeter | undefined = this.meterOf(axis);
            if (meter === (void 0)) {
                continue;
            }
            const remaining: number = this.axisRemaining(axis);
            const charged: number = amount > remaining ? Math.max(0, remaining) : amount;
            if (charged === 0) {
                continue;
            }
            meter.dispatcher.run((): void => {
                return;
            }, { tokens: charged, calls: 0, ms: 0 });
        }
    }

    private currentStep(): AmpProcessStep | undefined {
        if (this.process === null) {
            return (void 0);
        }
        return this.process.steps[this.stepIndex];
    }

    private findAffordance(id: string): AmpAffordance | undefined {
        return this.affordances.find((affordance: AmpAffordance): boolean => {
            return affordance.id === id;
        });
    }

    private isGrantValid(grant: AmpGrantView): boolean {
        return grant.caseId === CASE_ID
            && grant.step === "03_approve"
            && Date.parse(grant.expires) > Date.now();
    }

    private grantForApproval(approval: string | undefined): AmpGrantView | undefined {
        if (approval === (void 0)) {
            return (void 0);
        }
        const direct: AmpGrantView | undefined = this.grants.get(approval);
        if (direct !== (void 0)) {
            return direct;
        }
        return [...this.grants.values()].find((grant: AmpGrantView): boolean => {
            return grant.id === approval;
        });
    }

    private hasGrantForCurrentCase(): boolean {
        return this.caseGrants.some((handle: string): boolean => {
            const grant: AmpGrantView | undefined = this.grants.get(handle);
            return grant !== (void 0) && this.isGrantValid(grant);
        });
    }

    private toolSchemaOf(affordance: AmpAffordance): ToolSchema {
        return { name: affordance.id, inputSchema: this.inputSchemaOf(affordance.id) };
    }

    private inputSchemaOf(affordanceId: string): unknown {
        if (affordanceId === "a:read_dataset") {
            return {
                type: "object",
                properties: { path: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 5000 } },
                additionalProperties: false,
            };
        }
        if (affordanceId === "a:validate_dataset") {
            return {
                type: "object",
                properties: { sample_size: { type: "integer", minimum: 1, maximum: 5000 } },
                additionalProperties: false,
            };
        }
        if (affordanceId === "a:approve_publish") {
            return {
                type: "object",
                properties: { decision: { type: "string", enum: ["approve", "deny"] }, note: { type: "string", maxLength: 280 } },
                additionalProperties: false,
            };
        }
        return {
            type: "object",
            properties: { path: { type: "string", minLength: 1 } },
            additionalProperties: false,
        };
    }

    private tryParseArgs(affordance: AmpAffordance, args: Record<string, unknown> | undefined): ParseOutcome {
        try {
            return { ok: true, parsed: parseToolCall(this.toolSchemaOf(affordance), args ?? {}) };
        } catch (error) {
            if (error instanceof BoundaryRejection) {
                return { ok: false, code: "BOUNDARY_REJECTED", message: error.message };
            }
            throw error;
        }
    }

    private checkEffectsAck(affordance: AmpAffordance, ack: string[] | undefined): AmpError | undefined {
        const declared: string[] = affordance.effects.map((effect: AmpEffect): string => {
            return effectKey(effect);
        });
        const provided: string[] = Array.isArray(ack) ? ack : [];
        const missing: string[] = declared.filter((key: string): boolean => {
            return !provided.includes(key);
        });
        if (missing.length > 0) {
            return { code: "EFFECT_UNDECLARED", message: `effects not acknowledged: ${missing.join(", ")}` };
        }
        const effectRefs: RefTable = RefTable.forScope("run");
        const declaredUnique: string[] = [...new Set<string>(declared)];
        for (const key of declaredUnique) {
            effectRefs.add("capability", normalizeId(key), key);
        }
        for (const key of provided) {
            try {
                effectRefs.require({ kind: "capability", id: normalizeId(key) });
            } catch (error) {
                if (error instanceof BoundaryRejection) {
                    return { code: "BOUNDARY_REJECTED", message: error.message };
                }
                throw error;
            }
        }
        return (void 0);
    }

    private actionRequestFor(affordance: AmpAffordance, parsed: ParsedToolCall): ActionRequest {
        const request: ActionRequest = {
            action: affordance.id,
            target: { kind: "tool", id: normalizeId(affordance.id) },
            effect: effectClassOf(affordance),
            toolDigest: digestOf({ id: affordance.id, effects: affordance.effects, cost: affordance.cost }),
            argsDigest: parsed.digest,
            requestedBy: { kind: "self", id: AGENT_REF_ID },
        };
        const claim: Claim | undefined = this.claimFor(affordance.id);
        if (claim !== (void 0)) {
            request.claim = claim;
        }
        if (affordance.id === "a:publish_result") {
            request.minTier = "T3";
        }
        return request;
    }

    private claimFor(affordanceId: string): Claim | undefined {
        const mapping: Record<string, string> = {
            "a:read_dataset": "c:dataset-2026-exists",
            "a:validate_dataset": "c:dataset-2026-rows",
            "a:approve_publish": "c:row-count-conflict",
            "a:publish_result": "c:row-count-conflict",
        };
        const claimId: string | undefined = mapping[affordanceId];
        if (claimId === (void 0)) {
            return (void 0);
        }
        return this.claims.find((claim: Claim): boolean => {
            return claim.id === claimId;
        });
    }

    private checkLease(affordance: AmpAffordance): AmpError | undefined {
        if (this.lease === null) {
            return { code: "LEASE_EXPIRED", message: "lease is missing" };
        }
        if (Date.parse(this.lease.expires) <= Date.now()) {
            return { code: "LEASE_EXPIRED", message: "lease expired" };
        }
        if (this.lease.subject !== SUBJECT) {
            return { code: "PERMISSION_DENIED", message: "lease subject does not match" };
        }
        if (!this.lease.ops.includes("act")) {
            return { code: "PERMISSION_DENIED", message: "lease does not allow act" };
        }
        const lease: AmpLeaseView = this.lease;
        const outsideScope: boolean = affordance.effects.some((effect: AmpEffect): boolean => {
            return !lease.scope.includes(WORLD_ID) && !lease.scope.includes(effect.scope);
        });
        if (outsideScope) {
            return { code: "PERMISSION_DENIED", message: "lease audience does not cover the effect scope" };
        }
        return (void 0);
    }

    private controlFailure(error: unknown): AmpError {
        if (error instanceof CostCeilingExceeded) {
            return { code: "BUDGET_EXCEEDED", message: error.message };
        }
        if (error instanceof RateLimited) {
            return { code: "RATE_LIMITED", message: error.message };
        }
        if (error instanceof CircuitOpen) {
            return { code: "CIRCUIT_OPEN", message: error.message };
        }
        if (error instanceof Error) {
            return { code: "ENGINE_ERROR", message: error.message };
        }
        return { code: "ENGINE_ERROR", message: "unknown dispatch failure" };
    }

    private async execute(affordance: AmpAffordance, parsed: ParsedToolCall, grant: AmpGrantView | undefined): Promise<{ handle: string; effect: AmpEffectKind }> {
        if (affordance.id === "a:read_dataset") {
            const limit: number = typeof parsed.args.limit === "number" ? parsed.args.limit : 2;
            const handle: string = this.createHandle({
                dataset: "calendar-2026",
                rows: 1280,
                columns: ["date", "event", "lunar_date"],
                sample: [
                    { date: "2026-01-01", event: "元旦", lunar_date: "冬月十三" },
                    { date: "2026-02-17", event: "春节", lunar_date: "正月初一" },
                ].slice(0, limit),
            }, "trusted", [normalizeId(affordance.id)], "application/json", 600000);
            return { handle, effect: "read" };
        }
        if (affordance.id === "a:validate_dataset") {
            await this.addConflictClaim();
            const handle: string = this.createHandle({
                status: "mismatch",
                expected_rows: 1280,
                observed_rows: 1284,
                blocking_claim: "c:row-count-conflict",
                schema: "calendar-v3",
            }, "trusted", [normalizeId(affordance.id)], "application/amp+json", 600000);
            return { handle, effect: "read" };
        }
        if (affordance.id === "a:approve_publish") {
            return this.createGrant(affordance);
        }
        if (grant === (void 0)) {
            throw new Error("publish executed without a grant");
        }
        const handle: string = this.createHandle({
            published: true,
            dataset: "calendar-2026",
            rows: 1284,
            path: "dist/calendar-2026.json",
        }, "trusted", [normalizeId(affordance.id), grant.handle], "application/json", 600000);
        return { handle, effect: "irreversible" };
    }

    private createGrant(affordance: AmpAffordance): { handle: string; effect: AmpEffectKind } {
        if (this.policy === null || this.lease === null) {
            throw new Error("policy is not initialised");
        }
        const grantHandle: string = this.createHandle({
            case_id: CASE_ID,
            step: "03_approve",
            scope: "publish:dataset:2026",
            evidence: ["c:row-count-conflict"],
        }, "trusted", [normalizeId(affordance.id)], "application/amp+json", 600000);
        const grant: AmpGrantView = {
            id: `g:${CASE_ID}:03_approve`,
            handle: grantHandle,
            caseId: CASE_ID,
            step: "03_approve",
            expires: this.lease.expires,
        };
        const approval: { id: string } = this.policy.approve({
            action: "a:publish_result",
            effect: "publish",
            approvedBy: "human:approver",
            ttlMs: 10 * 60 * 1000,
            scope: [grantHandle, PRIMARY_SCOPE],
        });
        this.grants.set(grantHandle, grant);
        this.grantApprovals.set(grantHandle, approval.id);
        this.caseGrants.push(grantHandle);
        return { handle: grantHandle, effect: "grant" };
    }

    private createHandle(payload: unknown, taint: AmpTaint, lineage: string[], media: string, ttlMs: number): string {
        if (this.handleStore === null) {
            throw new Error("handle store is not initialised");
        }
        const content: string = canonical(payload);
        const tokens: number = tokenCostOf(content);
        const handle: Handle = this.handleStore.put(content, "text", tokens, "session", ttlMs);
        const record: HandleRecord = {
            handle,
            payload,
            taint,
            media,
            lineage,
            created_at: new Date().toISOString(),
            expires: isoAfter(ttlMs),
        };
        this.handleRecords.set(handle.id, record);
        return handle.id;
    }

    private recordHandleReceipt(record: HandleRecord, cost: AmpCost, projection: string): void {
        const receipt: Receipt = {
            amp: "0.1",
            kind: "receipt",
            id: `rcpt.${String(this.receiptSeq)}`,
            op: "read",
            target: { kind: "handle", id: normalizeId(record.handle.id) },
            at: new Date().toISOString(),
            ms: cost.time_ms,
            usage: usageOf(cost),
            outcome: "success",
            handle: record.handle,
            note: `projection ${projection}`,
        };
        this.receiptSeq += 1;
        this.ledger.receipts.push(receipt);
    }

    private recordReceipt(affordance: AmpAffordance, handleId: string, cost: AmpCost): void {
        const now: string = new Date().toISOString();
        const predicted: number = round3(clamp01(this.claimFor(affordance.id)?.confidence ?? 0.7));
        const receipt: Receipt = {
            amp: "0.1",
            kind: "receipt",
            id: `rcpt.${String(this.receiptSeq)}`,
            op: "act",
            target: { kind: "tool", id: normalizeId(affordance.id) },
            at: now,
            ms: cost.time_ms,
            usage: usageOf(cost),
            outcome: "success",
            predicted_voi: predicted,
            realized_voi: 1,
            handle: { id: handleId, kind: "text", tokens: cost.tokens, scope: "session" },
            note: `${affordance.id} applied`,
        };
        this.receiptSeq += 1;
        this.ledger.receipts.push(receipt);
        const capability: CapabilityRecord = this.capabilityState(affordance.id);
        capability.receipts.push(handleId);
        capability.successes += 1;
        const evidenceId: string = `e:receipt-${String(this.receiptSeq)}-${normalizeId(affordance.id)}`;
        const evidence: EvidenceItem = {
            id: evidenceId,
            kind: "test",
            trust: "verified",
            independence: 0.9,
            relation: "supports",
            entails: true,
            origin: "runtime:executor",
            at: now,
        };
        capability.evidence.push(evidence);
        if (this.reliability !== null) {
            this.reliability.observe("runtime:executor", true);
        }
        this.calibrationPoints.push({ predicted, actual: true });
    }

    private capabilityState(id: string): CapabilityRecord {
        const existing: CapabilityRecord | undefined = this.capabilities.get(id);
        if (existing !== (void 0)) {
            return existing;
        }
        const created: CapabilityRecord = {
            id,
            prior: this.capabilityPrior(id),
            evidence: [],
            receipts: [],
            successes: 0,
            failures: 0,
        };
        this.capabilities.set(id, created);
        return created;
    }

    private capabilityPrior(id: string): number {
        if (id === "a:read_dataset") {
            return 0.55;
        }
        if (id === "a:validate_dataset") {
            return 0.52;
        }
        if (id === "a:approve_publish") {
            return 0.6;
        }
        return 0.45;
    }

    private rebuildRefTable(): RefTable {
        const refs: RefTable = RefTable.forScope("run", AGENT_REF_ID);
        for (const claim of this.claims) {
            refs.add("claim", normalizeId(claim.id), claim);
        }
        for (const affordance of this.affordances) {
            refs.add("capability", normalizeId(affordance.id), affordance);
        }
        return refs;
    }

    private refreshSlice(): void {
        const built: { slice: AmpSliceItem[]; whyNot: AmpWhyNot[]; frame: AmpFrameView | undefined } = this.buildSlice(this.intent, this.lastLevel);
        this.slice = built.slice;
        this.whyNot = built.whyNot;
        this.frameView = built.frame;
    }

    private buildSlice(intent: string, level: AmpLevel): { slice: AmpSliceItem[]; whyNot: AmpWhyNot[]; frame: AmpFrameView | undefined } {
        if (this.world === null) {
            return { slice: [], whyNot: [], frame: (void 0) };
        }
        const refs: RefTable = this.rebuildRefTable();
        const candidates: Candidate[] = [];
        const meta: Map<string, CandidateMeta> = new Map<string, CandidateMeta>();
        const currentAffordance: string | undefined = this.currentStep()?.affordance;

        for (const claim of this.claims) {
            const confidence: number = claim.confidence ?? deriveConfidence(claim);
            const subject: string = claim.structured?.subject?.id ?? normalizeId(PRIMARY_SCOPE);
            const predicate: string = claim.structured?.relation ?? "statement";
            const trust: Trust = claim.provenance.trust ?? "trusted";
            const taint: AmpTaint = taintOfTrust(trust);
            const conflict: boolean = claim.disconfirming !== (void 0) && claim.disconfirming.length > 0;
            const line: string = `${claim.id} ${predicate}=${canonical(claim.structured?.value)} conf=${confidence.toFixed(2)} taint=${taint}`;
            const relevance: number = clamp01(relevanceOf(`${predicate} ${subject} ${claim.statement}`, intent) + (conflict ? 0.25 : 0));
            const inputs: AmpScoreInputs = {
                voi: clamp01(confidence),
                goalFit: relevance,
                uncertainty: clamp01(1 - confidence),
                novelty: conflict ? 0.9 : 0.15,
                costTokens: tokenCostOf(line),
                risk: taint === "untrusted" ? 0.3 : 0,
                trustCap: taint === "trusted" ? 1 : 0.35,
            };
            const candidate: Candidate = {
                target: { kind: "claim", id: normalizeId(claim.id) },
                role: "evidence",
                tier: claim.tier,
                voi: inputs.voi,
                goalFit: inputs.goalFit,
                uncertainty: inputs.uncertainty,
                novelty: inputs.novelty,
                costTokens: inputs.costTokens,
                risk: inputs.risk,
                trustCap: inputs.trustCap,
                why: conflict ? "conflict claim kept next to its peer" : `held ${claim.tier} claim from ${claim.provenance.source}`,
            };
            candidates.push(candidate);
            meta.set(`claim:${candidate.target.id}`, {
                kind: "claim",
                id: claim.id,
                candidate,
                inputs,
                components: this.componentsOf(inputs),
                line,
            });
        }

        for (const affordance of this.affordances) {
            const bonus: number = affordance.id === currentAffordance ? 0.2 : 0;
            const effectText: string = affordance.effects.map((effect: AmpEffect): string => {
                return effectKey(effect);
            }).join("/");
            const line: string = `${affordance.id} ${affordance.title} effects=${effectText} cost=${String(affordance.cost.tokens)}t risk=${String(affordance.cost.risk)}`;
            const inputs: AmpScoreInputs = {
                voi: clamp01(1 - affordance.cost.risk),
                goalFit: clamp01(relevanceOf(`${affordance.title} ${affordance.intent}`, intent) + bonus),
                uncertainty: clamp01(affordance.cost.risk),
                novelty: 0.2,
                costTokens: Math.max(1, affordance.cost.tokens),
                risk: affordance.cost.risk,
                trustCap: 1,
            };
            const candidate: Candidate = {
                target: { kind: "tool", id: normalizeId(affordance.id) },
                role: "tool",
                tier: "T2",
                voi: inputs.voi,
                goalFit: inputs.goalFit,
                uncertainty: inputs.uncertainty,
                novelty: inputs.novelty,
                costTokens: inputs.costTokens,
                risk: inputs.risk,
                trustCap: inputs.trustCap,
                why: `affordance declared by the world manifest with ${String(affordance.effects.length)} effect(s)`,
            };
            candidates.push(candidate);
            meta.set(`tool:${candidate.target.id}`, {
                kind: "affordance",
                id: affordance.id,
                candidate,
                inputs,
                components: this.componentsOf(inputs),
                line,
            });
        }

        const budgetTokens: number = Math.max(1, Math.floor(this.axisRemaining("tokens")));
        const selection: Selection = selectFocus(candidates, {
            budgetTokens,
            cap: sliceCapFor(level),
            threshold: 0.12,
        });
        const slice: AmpSliceItem[] = [];
        for (const slot of selection.slots) {
            const entry: CandidateMeta | undefined = meta.get(`${slot.target.kind}:${slot.target.id}`);
            if (entry === (void 0)) {
                continue;
            }
            slice.push({
                kind: entry.kind,
                id: entry.id,
                level,
                line: entry.line,
                value: slot.salience,
                components: entry.components,
                inputs: entry.inputs,
            });
        }
        const whyNot: AmpWhyNot[] = selection.ignored.map((ignored: Ignored): AmpWhyNot => {
            return { id: this.displayIdOf(ignored.target, meta), reason: `${ignored.reason}: ${ignored.revisit_if}` };
        });

        const frameSlots: Slot[] = selection.slots.map((slot: Slot): Slot => {
            return {
                target: { kind: slot.target.kind, id: slot.target.id },
                role: slot.role,
                tier: slot.tier ?? "T2",
                salience: slot.salience,
                voi: slot.voi,
                cost: { tokens: Math.ceil(slot.cost.tokens ?? 0) },
                budget: { tokens: Math.ceil(slot.budget?.tokens ?? 0) },
                why: slot.why,
                state: "active",
            };
        });
        const frameIgnored: Ignored[] = selection.ignored.map((ignored: Ignored): Ignored => {
            return { target: { kind: ignored.target.kind, id: ignored.target.id }, reason: ignored.reason, revisit_if: ignored.revisit_if };
        });
        const spentTokens: number = frameSlots.reduce((sum: number, slot: Slot): number => {
            return sum + (slot.cost.tokens ?? 0);
        }, 0);
        this.frameCycle += 1;
        const mode: FrameMode = frameModeFor(level);
        const draft: FrameDraft = {
            id: `frame:${String(this.frameCycle)}`,
            agent: AGENT_REF_ID,
            cycle: this.frameCycle,
            ts: new Date().toISOString(),
            mode,
            slots: frameSlots,
            ignored: frameIgnored,
            budget: { allocated: { tokens: Math.max(1, budgetTokens) }, spent: { tokens: spentTokens } },
        };
        const built: { frame: Frame; deferred: Ignored[] } = frameFrom(draft, refs, {
            maxSlots: 9,
            now: (): string => {
                return new Date().toISOString();
            },
        });
        for (const deferred of built.deferred) {
            whyNot.push({ id: this.displayIdOf(deferred.target, meta), reason: `${deferred.reason}: ${deferred.revisit_if}` });
        }
        const frameView: AmpFrameView = {
            id: built.frame.id,
            digest: built.frame.digest,
            mode: built.frame.mode,
            cycle: built.frame.cycle,
            slots: built.frame.slots.length,
            ignored: built.frame.ignored === (void 0) ? 0 : built.frame.ignored.length,
        };
        return { slice, whyNot, frame: frameView };
    }

    private componentsOf(inputs: AmpScoreInputs): AmpScoreComponents {
        return {
            V: inputs.voi,
            C: costFactorOf(inputs),
            relevance: inputs.goalFit,
            trust: clamp01(inputs.trustCap),
            fresh: 0.5 + inputs.uncertainty,
            diversity: 1 + 0.5 * inputs.novelty,
        };
    }

    private displayIdOf(target: Ref, meta: Map<string, CandidateMeta>): string {
        const entry: CandidateMeta | undefined = meta.get(`${target.kind}:${target.id}`);
        return entry === (void 0) ? target.id : entry.id;
    }

    private advanceCase(affordanceId: string): void {
        if (this.plan === null || this.lifecycle === null || this.process === null) {
            return;
        }
        const step: AmpProcessStep | undefined = this.currentStep();
        if (step !== (void 0)) {
            const task: PlanTask | undefined = this.plan.tasks.find((item: PlanTask): boolean => {
                return item.id === step.id;
            });
            if (task !== (void 0)) {
                task.status = "done";
            }
        }
        this.stepIndex += 1;
        const finished: boolean = affordanceId === "a:publish_result" || this.stepIndex >= this.process.steps.length;
        if (finished) {
            this.caseState = "completed";
            if (this.lifecycle.state === "active") {
                this.lifecycle = transitionGoal(this.lifecycle, "achieved", new Date().toISOString());
            }
            return;
        }
        const nextStep: AmpProcessStep | undefined = this.process.steps[this.stepIndex];
        if (nextStep === (void 0)) {
            return;
        }
        const nextTask: PlanTask | undefined = this.plan.tasks.find((item: PlanTask): boolean => {
            return item.id === nextStep.id;
        });
        if (nextTask !== (void 0)) {
            nextTask.status = "running";
        }
    }

    private caseView(): AmpCaseView {
        const state: AmpCaseState = this.lifecycle !== null && this.lifecycle.state === "achieved"
            ? "completed"
            : this.lifecycle !== null && this.lifecycle.state === "abandoned"
                ? "failed"
                : this.caseState;
        return { id: CASE_ID, process: PROCESS_ID, state, stepIndex: this.stepIndex, grants: [...this.caseGrants] };
    }

    private createInitialClaims(now: string, validUntil: string): Claim[] {
        const seeds: ClaimSeed[] = [
            {
                id: "c:dataset-2026-exists",
                statement: "2026 年历法数据集存在于发布目录",
                subject: PRIMARY_SCOPE,
                relation: "exists",
                value: true,
                tier: "T2",
                baseRate: 0.9,
                priorSource: "base-rate:dataset/exists/v1",
                evidence: [
                    { id: "e:fs-stat", kind: "observation", trust: "self", independence: 1, relation: "supports", entails: true, origin: "runtime:fs" },
                ],
            },
            {
                id: "c:dataset-2026-rows",
                statement: "源文件声明行数为 1280",
                subject: PRIMARY_SCOPE,
                relation: "row_count",
                value: 1280,
                tier: "T2",
                baseRate: 0.85,
                priorSource: "base-rate:dataset/row-count/v1",
                evidence: [
                    { id: "e:source-count", kind: "observation", trust: "self", independence: 1, relation: "supports", entails: true, origin: "runtime:source" },
                ],
            },
            {
                id: "c:dataset-2026-schema",
                statement: "数据集使用 calendar-v3 schema",
                subject: PRIMARY_SCOPE,
                relation: "schema",
                value: "calendar-v3",
                tier: "T2",
                baseRate: 0.8,
                priorSource: "base-rate:dataset/schema/v1",
                evidence: [
                    { id: "e:schema-check", kind: "test", trust: "self", independence: 1, relation: "supports", entails: true, origin: "runtime:schema" },
                ],
            },
        ];
        return seeds.map((seed: ClaimSeed): Claim => {
            return this.buildClaim(seed, now, validUntil);
        });
    }

    private buildClaim(seed: ClaimSeed, now: string, validUntil: string): Claim {
        const evidence: EvidenceItem[] = seed.evidence.map((item: ClaimSeedEvidence): EvidenceItem => {
            return {
                id: item.id,
                kind: item.kind,
                trust: item.trust,
                independence: item.independence,
                relation: item.relation,
                entails: item.entails,
                origin: item.origin,
                at: now,
            };
        });
        const claim: Claim = {
            amp: "0.1",
            kind: "claim",
            id: seed.id,
            statement: seed.statement,
            structured: { subject: { kind: "entity", id: normalizeId(seed.subject) }, relation: seed.relation, value: seed.value },
            claim_scope: "associational",
            tier: seed.tier,
            status: "held",
            warrant: { evidence, inference: "observation", strength: 0.8 },
            base_rate: { value: seed.baseRate, source: seed.priorSource },
            provenance: { source: "runtime:executor", kind: "tool", trust: "trusted", at: now },
            created: now,
            expires: validUntil,
        };
        if (seed.causal !== (void 0)) {
            claim.causal = seed.causal;
        }
        if (seed.conflictsWith !== (void 0)) {
            claim.disconfirming = seed.conflictsWith.map((id: string): Ref => {
                return { kind: "claim", id };
            });
        }
        const problems: string[] = validateClaim(claim);
        if (problems.length > 0) {
            throw new Error(`claim ${seed.id} is not admissible: ${problems.join("; ")}`);
        }
        claim.confidence = deriveConfidence(claim);
        return claim;
    }

    private async addConflictClaim(): Promise<void> {
        if (this.claims.some((claim: Claim): boolean => {
            return claim.id === "c:row-count-conflict";
        })) {
            return;
        }
        if (this.lease === null) {
            throw new Error("lease is not initialised");
        }
        const now: string = new Date().toISOString();
        const conflictSeed: ClaimSeed = {
            id: "c:row-count-conflict",
            statement: "校验重数得到 1284 行，与源文件声明的 1280 行冲突",
            subject: PRIMARY_SCOPE,
            relation: "row_count_conflict",
            value: { expected: 1280, observed: 1284 },
            tier: "T3",
            baseRate: 0.5,
            priorSource: "base-rate:validation/mismatch/v1",
            evidence: [
                { id: "e:validation-recount", kind: "test", trust: "verified", independence: 1, relation: "supports", entails: true, origin: "runtime:validator" },
            ],
            conflictsWith: ["c:dataset-2026-rows"],
            causal: { assignment_mechanism: "randomized", identification_strategy: "randomized recount sample" },
        };
        const claim: Claim = this.buildClaim(conflictSeed, now, this.lease.expires);
        this.claims.push(claim);
        if (this.evidenceGraph !== null) {
            this.evidenceGraph.addClaim(claim.id, claim.statement);
            for (const item of claim.warrant.evidence) {
                this.evidenceGraph.addEvidence(item.id, claim.statement, claim.id, item.trust);
            }
            this.evidenceGraph.link("c:dataset-2026-rows", claim.id);
            const affected: string[] = this.evidenceGraph.impact(["e:validation-recount"]).map((item): string => {
                return item.id;
            });
            this.impact = { changed: "e:validation-recount", affected };
        }
        for (const unknown of this.unknowns) {
            if (unknown.id === "u:row-count") {
                unknown.status = "resolved";
            }
        }
        this.unknowns.push({
            amp: "0.1",
            kind: "unknown",
            id: "u:row-count-conflict",
            question: "源文件行数是 1280、校验结果是 1284，哪一个正确？",
            importance: 0.9,
            blocking: true,
            since: now,
            attempts: [{ kind: "tool", id: normalizeId("a:validate_dataset") }],
            status: "open",
        });
        this.worldVersion += 1;
        this.world = await this.signWorld();
        this.refreshSlice();
    }

    private createInitialUnknowns(now: string): UnknownItem[] {
        return [
            {
                amp: "0.1",
                kind: "unknown",
                id: "u:row-count",
                question: "源文件行数是否与声明一致？",
                importance: 0.82,
                blocking: true,
                since: now,
                attempts: [{ kind: "tool", id: normalizeId("a:validate_dataset") }],
                status: "open",
            },
            {
                amp: "0.1",
                kind: "unknown",
                id: "u:schema-compat",
                question: "calendar-v3 schema 是否兼容当前发布器？",
                importance: 0.41,
                blocking: false,
                since: now,
                attempts: [{ kind: "claim", id: "c:dataset-2026-schema" }],
                status: "probing",
            },
        ];
    }

    private buildEvidenceGraph(claims: Claim[]): EvidenceGraph {
        const graph: EvidenceGraph = new EvidenceGraph();
        for (const claim of claims) {
            graph.addClaim(claim.id, claim.statement);
            for (const item of claim.warrant.evidence) {
                graph.addEvidence(item.id, claim.statement, claim.id, item.trust);
            }
        }
        if (graph.hasCycle()) {
            throw new Error("evidence graph contains a cycle");
        }
        return graph;
    }

    private createCaseGoal(now: string): GoalLifecycle {
        if (this.process === null) {
            throw new Error("process must exist before the goal");
        }
        const success: Criterion[] = this.process.steps.map((step: AmpProcessStep): Criterion => {
            return { id: `criterion:${step.id}`, statement: step.title, check: `receipt:${step.affordance}`, kind: "query" };
        });
        const goal: Goal = {
            amp: "0.1",
            kind: "goal",
            id: `goal:${PROCESS_ID}`,
            statement: "完成 2026 年历法数据导入：读取、校验、审批、发布",
            success,
            value: 0.8,
            priority: 1,
            horizon: "task",
        };
        const proposed: GoalLifecycle = createGoalLifecycle(goal);
        const committed: GoalLifecycle = transitionGoal(proposed, "committed", now);
        return transitionGoal(committed, "active", now);
    }

    private createPlan(now: string): Plan {
        if (this.process === null || this.lifecycle === null) {
            throw new Error("process and goal must exist before the plan");
        }
        const tasks: PlanTask[] = this.process.steps.map((step: AmpProcessStep, index: number): PlanTask => {
            return {
                id: step.id,
                intent: step.title,
                actor: "tool",
                ref: { kind: "tool", id: normalizeId(step.affordance) },
                pre: step.requires ?? [],
                expect: { observation: `receipt for ${step.affordance}`, check: `receipt:${step.affordance}` },
                irreversibility: index === 3 ? 3 : index === 2 ? 1 : 0,
                budget: { tokens: this.caps === null ? 0 : this.caps.tokens },
                status: index === 0 ? "running" : "pending",
            };
        });
        const edges: Array<[string, string]> = [];
        for (let index: number = 0; index < tasks.length - 1; index += 1) {
            edges.push([tasks[index].id, tasks[index + 1].id]);
        }
        return {
            amp: "0.1",
            kind: "plan",
            id: `plan:${PROCESS_ID}`,
            goal: { kind: "goal", id: this.lifecycle.goal.id },
            process: { kind: "process", id: PROCESS_ID },
            tasks,
            edges,
            commitment_window: 1,
            budget: { tokens: this.caps === null ? 0 : this.caps.tokens },
            abandon_if: [{ id: "criterion:abandon", statement: "发布会话超过租约期限", check: "lease:expired", kind: "observe" }],
            rollback: "delete dist/calendar-2026.json",
            status: "executing",
            created: now,
        };
    }

    private createAffordances(): AmpAffordance[] {
        return [
            {
                id: "a:read_dataset",
                title: "读取数据",
                intent: "读取 2026 年历法数据集，取得行数与字段样例。",
                level: "L2",
                effects: [{ kind: "read", scope: PRIMARY_SCOPE, reversible: true, receipt: true }],
                preconditions: ["c:dataset-2026-exists"],
                permissions: ["role:analyst"],
                cost: makeCost(120, 5, 4096, 1, 0.05),
                verification: { method: "receipt" },
            },
            {
                id: "a:validate_dataset",
                title: "校验数据",
                intent: "校验行数、字段与 schema 版本，产生冲突 claim。",
                level: "L2",
                effects: [{ kind: "read", scope: PRIMARY_SCOPE, reversible: true, receipt: true }],
                preconditions: ["c:dataset-2026-exists"],
                permissions: ["role:analyst"],
                cost: makeCost(200, 15, 8192, 1, 0.1),
                verification: { method: "receipt" },
            },
            {
                id: "a:approve_publish",
                title: "审批发布",
                intent: "人工审批发布门，产生有范围和期限的 grant。",
                level: "L2",
                effects: [{ kind: "grant", scope: "03_approve", reversible: true, receipt: true }],
                preconditions: ["c:row-count-conflict"],
                permissions: ["role:approver"],
                cost: makeCost(80, 5, 1024, 2, 0.15, 1),
                verification: { method: "receipt" },
            },
            {
                id: "a:publish_result",
                title: "发布结果",
                intent: "发布 2026 年历法结果；不可逆，必须出示 grant。",
                level: "L2",
                effects: [{ kind: "irreversible", scope: PRIMARY_SCOPE, reversible: false, receipt: true }],
                preconditions: ["grant:03_approve"],
                permissions: ["role:analyst"],
                cost: makeCost(150, 20, 16384, 3, 0.3),
                verification: { method: "receipt" },
            },
        ];
    }

    private createProcess(): AmpProcess {
        return {
            id: PROCESS_ID,
            title: "历法数据导入 2026",
            steps: [
                { id: "01_read", title: "读取数据", affordance: "a:read_dataset" },
                { id: "02_validate", title: "校验数据", affordance: "a:validate_dataset" },
                { id: "03_approve", title: "审批发布", affordance: "a:approve_publish", requires: ["role:approver"] },
                { id: "04_publish", title: "发布结果", affordance: "a:publish_result", requires: ["grant:03_approve"] },
            ],
        };
    }

    private async signWorld(): Promise<AmpManifestView> {
        if (this.signingKey === null) {
            throw new Error("signing key is not initialised");
        }
        const payload: WorldPayload = {
            id: WORLD_ID,
            version: this.worldVersion,
            issued_at: this.worldIssued,
            valid_until: this.worldValidUntil,
            claims: this.claims.map((claim: Claim): AmpClaim => {
                return this.claimView(claim);
            }),
            affordances: this.affordances,
            process: this.process === null ? { id: PROCESS_ID, title: "历法数据导入 2026", steps: [] } : this.process,
        };
        const signed: Manifest = await signManifest(payload as unknown as Parameters<typeof signManifest>[0], this.signingKey);
        const recomputed: string = contentDigest(payload as unknown as Parameters<typeof contentDigest>[0]);
        if (recomputed !== signed.digest) {
            throw new Error("manifest digest is not reproducible");
        }
        const verdict: { ok: boolean; reasons: string[] } = await verifyManifest(signed, this.signingKey.publicKey);
        if (!verdict.ok) {
            throw new Error(`world manifest signature does not verify: ${verdict.reasons.join("; ")}`);
        }
        const view: AmpManifestView = {
            ...payload,
            digest: signed.digest,
            signatures: signed.signatures,
        };
        if (this.publicJwk !== (void 0)) {
            view.public_key = this.publicJwk;
        }
        return view;
    }

    private claimView(claim: Claim): AmpClaim {
        const belief: AmpBelief = this.buildClaimBelief(claim);
        const confidence: number = claim.confidence ?? deriveConfidence(claim);
        const graphEvidence: string[] = this.evidenceGraph === null ? [] : this.evidenceGraph.evidenceFor(claim.id);
        const evidenceIds: string[] = graphEvidence.length > 0 ? graphEvidence : claim.warrant.evidence.map((item: EvidenceItem): string => {
            return item.id;
        });
        const view: AmpClaim = {
            id: claim.id,
            subject: claim.structured?.subject?.id ?? normalizeId(PRIMARY_SCOPE),
            predicate: claim.structured?.relation ?? "statement",
            object: claim.structured?.value,
            confidence,
            belief,
            observed_at: claim.created,
            valid_until: claim.expires ?? this.worldValidUntil,
            provenance: {
                source: claim.provenance.source,
                method: claim.provenance.kind ?? "observation",
                evidence: evidenceIds,
            },
            taint: taintOfTrust(claim.provenance.trust ?? "trusted"),
        };
        if (claim.disconfirming !== (void 0) && claim.disconfirming.length > 0) {
            view.conflicts_with = claim.disconfirming.map((ref: Ref): string => {
                return ref.id;
            });
        }
        return view;
    }

    private buildClaimBelief(claim: Claim): AmpBelief {
        const baseRate: number = claim.base_rate?.value ?? 0.5;
        const prior: BetaBelief = betaPriorOf(baseRate, 2);
        const items: BayesEvidence[] = claim.warrant.evidence.map((item: EvidenceItem): BayesEvidence => {
            return toBayesEvidence(item);
        });
        const ids: string[] = claim.warrant.evidence.map((item: EvidenceItem): string => {
            return item.id;
        });
        const clusters: string[] = claim.warrant.evidence.map((item: EvidenceItem): string => {
            return item.origin ?? item.id;
        });
        return this.buildBelief(prior, claim.base_rate?.source ?? "base-rate:default", items, ids, clusters, "bayes/posteriorOf(beta)");
    }

    private buildBelief(prior: BetaBelief, priorSource: string, items: BayesEvidence[], ids: string[], clusters: string[], model: string): AmpBelief {
        const posterior: Posterior = posteriorOf(prior, items, "correctness");
        const priorMean: number = betaMean(prior);
        const contributions: AmpLikelihoodContribution[] = [];
        let previous: number = priorMean;
        for (let index: number = 0; index < items.length; index += 1) {
            const step: Posterior = posteriorOf(prior, items.slice(0, index + 1), "correctness");
            const stepLogOdds: number = logit(step.mean);
            const logLr: number = stepLogOdds - logit(previous);
            contributions.push({
                evidence_id: ids[index],
                cluster: clusters[index],
                weight: items[index].reliability,
                log_lr: logLr,
                effective_log_lr: logLr,
            });
            previous = step.mean;
        }
        const effectiveLogOdds: number = logit(posterior.mean);
        const low: number = posterior.interval[0];
        const high: number = posterior.interval[1];
        return {
            prior: priorMean,
            prior_source: priorSource,
            evidence: ids,
            log_odds: effectiveLogOdds,
            posterior: posterior.mean,
            model,
            dependence: {
                rho: 0.2,
                clusters: new Set<string>(clusters).size,
                model: "beta-posterior/0.1",
            },
            trace: {
                prior_log_odds: logit(priorMean),
                contributions,
                effective_log_odds: effectiveLogOdds,
                posterior: posterior.mean,
                prior_sensitivity: {
                    low: logit(low),
                    high: logit(high),
                    flips: low < priorMean && priorMean < high,
                },
            },
        };
    }

    private buildSelfView(): AmpSelfView | undefined {
        if (this.world === null || this.lease === null || this.lifecycle === null || this.caps === null || this.values === null || this.reliability === null) {
            return (void 0);
        }
        const world: AmpManifestView = this.world;
        const lease: AmpLeaseView = this.lease;
        const caps: AmpBudget = this.caps;
        const values: AmpValuesView = this.values;
        const reliability: SourceReliability = this.reliability;
        const now: string = new Date().toISOString();
        const selfClaims: AmpClaim[] = [];
        const selfEvidence: AmpEvidence[] = [];
        const capabilities: AmpSelfCapability[] = [];
        const verifiedCapabilities: string[] = [];
        let successes: number = 0;
        let attempts: number = 0;

        for (const affordance of this.affordances) {
            const capability: CapabilityRecord = this.capabilityState(affordance.id);
            const prior: BetaBelief = betaPriorOf(capability.prior, 4);
            const items: BayesEvidence[] = capability.evidence.map((item: EvidenceItem): BayesEvidence => {
                return toBayesEvidence(item);
            });
            const posterior: Posterior = posteriorOf(prior, items, "correctness");
            const belief: AmpBelief = this.buildBelief(
                prior,
                `base-rate:affordance/${affordance.id}/v1`,
                items,
                capability.evidence.map((item: EvidenceItem): string => {
                    return item.id;
                }),
                capability.evidence.map((item: EvidenceItem): string => {
                    return item.origin ?? item.id;
                }),
                "bayes/posteriorOf(beta)",
            );
            const priorView: AmpBetaPrior = { mu: capability.prior, kappa: 4 };
            const posteriorView: AmpBetaPosterior = {
                alpha: posterior.alpha,
                beta: posterior.beta,
                mean: posterior.mean,
                sd: Math.sqrt(posterior.variance),
                n: posterior.evidenceCount,
                credible_interval: [posterior.interval[0], posterior.interval[1]],
            };
            const verified: boolean = capability.receipts.length > 0;
            if (verified) {
                verifiedCapabilities.push(affordance.id);
            }
            successes += capability.successes;
            attempts += capability.successes + capability.failures;
            for (const item of capability.evidence) {
                selfEvidence.push(evidenceView(item, reliability, now));
            }

            const permission: boolean = affordance.permissions.every((entry: string): boolean => {
                return ROLES.includes(entry);
            });
            const policyAllowed: boolean = this.selfPolicyVerdict(affordance);
            const needsGrant: boolean = affordance.effects.some((effect: AmpEffect): boolean => {
                return effect.kind === "irreversible" || effect.kind === "spend";
            });
            const grantAvailable: boolean = this.hasGrantForCurrentCase();
            const leaseValid: boolean = Date.parse(lease.expires) > Date.now();
            const budgetOk: boolean = this.fitsBudget(affordance.cost);
            const caseOpen: boolean = this.caseView().state === "open";
            const availableNow: boolean = caseOpen && permission && policyAllowed && leaseValid && budgetOk && (!needsGrant || grantAvailable);
            let reasonUnavailable: string | undefined = (void 0);
            if (!caseOpen) {
                reasonUnavailable = "case completed";
            } else if (!permission || !policyAllowed) {
                reasonUnavailable = "permission or warrant gate denies the action";
            } else if (!leaseValid) {
                reasonUnavailable = "lease expired";
            } else if (!budgetOk) {
                reasonUnavailable = "budget insufficient";
            } else if (needsGrant && !grantAvailable) {
                reasonUnavailable = "grant required";
            }
            const capabilityView: AmpSelfCapability = {
                affordance: affordance.id,
                label: affordance.title,
                verified,
                verification: verified ? "receipt" : "declared",
                confidence: posterior.mean,
                belief,
                evidence: capability.evidence.map((item: EvidenceItem): string => {
                    return item.id;
                }),
                reliability: { prior: priorView, posterior: posteriorView },
                available_now: availableNow,
            };
            if (capability.receipts.length > 0) {
                capabilityView.last_receipt = capability.receipts[capability.receipts.length - 1];
            }
            if (reasonUnavailable !== (void 0)) {
                capabilityView.reason_unavailable = reasonUnavailable;
            }
            capabilities.push(capabilityView);

            selfClaims.push({
                id: `c:self-${affordance.id.replace(/[^a-z0-9]/gi, "-")}`,
                subject: SELF_ID,
                predicate: "can_execute",
                object: { affordance: affordance.id, verification: capabilityView.verification },
                confidence: posterior.mean,
                belief,
                observed_at: now,
                valid_until: lease.expires,
                provenance: {
                    source: verified ? "runtime:executor" : "runtime:manifest",
                    method: verified ? "receipt" : "declared",
                    evidence: capability.evidence.map((item: EvidenceItem): string => {
                        return item.id;
                    }),
                },
                taint: "trusted",
            });
        }

        const used: AmpBudget = this.usedBudget();
        const health: { utilization: number; pressure: number; headroom: number; rest: boolean } = this.attentionHealthOf(used);
        const attention: AmpSelfAttention = {
            intent: this.intent,
            budget: copyBudget(caps),
            used,
            context_utilization: clamp01(used.tokens / Math.max(1, caps.tokens)),
            slice_size: this.slice.length,
            lease_expires: lease.expires,
            health,
        };
        const selfBase: Omit<AmpSelfView, "self_digest" | "horizon"> = {
            subject: SELF_ID,
            identity: {
                model_id: "amp-host/0.1-draft",
                runtime_version: "0.1.1-draft",
                principal: "did:web:periodicity.local",
                values_digest: values.digest,
                manifest_digest: world.digest,
                lease_id: lease.id,
                issued_at: lease.issued_at,
            },
            claims: selfClaims,
            evidence: selfEvidence,
            capabilities,
            permissions: this.buildPermissions(),
            attention,
            calibration: this.buildCalibration(),
            known_unknowns: this.buildKnownUnknowns(),
            failure_modes: this.buildFailureModes(),
            last_receipts: capabilities.flatMap((capability: AmpSelfCapability): string[] => {
                return capability.last_receipt === (void 0) ? [] : [capability.last_receipt];
            }),
            ledger_cursor: this.chainSnapshot().entries.length,
            throughput: qualityAdjustedThroughput({
                successes,
                attempts,
                errors: 0,
                rework: 0,
                attentionSlots: Math.max(1, Math.round(used.capability_load)),
            }),
        };
        const horizon: string[] = this.buildHorizon(verifiedCapabilities, selfBase);
        const withHorizon: Omit<AmpSelfView, "self_digest"> = { ...selfBase, horizon };
        return { ...withHorizon, self_digest: digestOf(withHorizon) };
    }

    private selfPolicyVerdict(affordance: AmpAffordance): boolean {
        if (this.policy === null) {
            return false;
        }
        const request: ActionRequest = {
            action: affordance.id,
            target: { kind: "tool", id: normalizeId(affordance.id) },
            effect: effectClassOf(affordance),
            requestedBy: { kind: "self", id: AGENT_REF_ID },
        };
        const claim: Claim | undefined = this.claimFor(affordance.id);
        if (claim !== (void 0)) {
            request.claim = claim;
        }
        return this.policy.decide(request).outcome !== "deny";
    }

    private attentionHealthOf(used: AmpBudget): { utilization: number; pressure: number; headroom: number; rest: boolean } {
        const load: number = clamp01(used.tokens / Math.max(1, this.caps === null ? 1 : this.caps.tokens));
        const verified: number = this.affordances.filter((affordance: AmpAffordance): boolean => {
            const capability: CapabilityRecord | undefined = this.capabilities.get(affordance.id);
            return capability !== (void 0) && capability.receipts.length > 0;
        }).length;
        const process: ProcessAttention = processAttention(0, {
            load,
            vigilance: clamp01(1 - load * 0.6),
            arousal: clamp01(used.risk),
            mastery: clamp01(verified / Math.max(1, this.affordances.length)),
            accountability: 0.8,
            cyclesSinceRest: this.ledger.receipts.length,
            capacityEff: Math.max(1, DefaultAttentionPolicy.baseSlots * (1 - 0.5 * load)),
            pLapse: clamp01(load * 0.5),
            dominantRole: "tool",
            source: "default",
            samples: this.calibrationPoints.length,
        });
        const plan: AttentionPlan = planAttention(process, [{ tid: this.stepIndex + 1, pid: 0, priority: 1, preferredSlots: 1, foreground: true }], DefaultAttentionPolicy);
        return attentionHealth(plan);
    }

    private buildPermissions(): SelfAttentionPermissions {
        const may: string[] = [];
        const requiresApproval: string[] = [];
        const boundaries: string[] = [];
        const approvalClasses: ReadonlySet<EffectClass> = this.approvalClasses();
        for (const affordance of this.affordances) {
            for (const effect of affordance.effects) {
                const key: string = effectKey(effect);
                if (effect.kind === "read" && !may.includes(key)) {
                    may.push(key);
                }
                if (approvalClasses.has(effectClassOfKind(effect.kind, effect.reversible)) && !requiresApproval.includes(key)) {
                    requiresApproval.push(key);
                }
            }
            for (const precondition of affordance.preconditions) {
                if (!boundaries.includes(precondition)) {
                    boundaries.push(precondition);
                }
            }
        }
        return { may, must_not: ["write:*"], requires_approval: requiresApproval, boundaries };
    }

    private buildCalibration(): AmpSelfCalibration {
        if (this.calibrationPoints.length === 0) {
            return { brier: null, ece: null, auc: null, n: 0, by_domain: {} };
        }
        const brierValue: number = brier(this.calibrationPoints);
        const eceValue: number = ece(this.calibrationPoints);
        return {
            brier: brierValue,
            ece: eceValue,
            auc: null,
            n: this.calibrationPoints.length,
            by_domain: { capability: { brier: brierValue, ece: eceValue, n: this.calibrationPoints.length } },
        };
    }

    private buildKnownUnknowns(): AmpKnownUnknown[] {
        return this.unknowns.map((item: UnknownItem): AmpKnownUnknown => {
            return {
                id: item.id,
                question: item.question,
                voi: item.importance,
                evidence_needed: (item.attempts ?? []).map((ref: Ref): string => {
                    return ref.id;
                }),
                blocking: item.blocking,
            };
        });
    }

    private buildFailureModes(): AmpSelfView["failure_modes"] {
        return [
            {
                id: "f:encoding",
                mode: "GBK/UTF-8 混淆",
                count: 2,
                last_seen: isoAfter(-24 * 60 * 60 * 1000),
                mitigation: "先做编码探测，再解析",
            },
        ];
    }

    private buildHorizon(verified: string[], selfBase: Omit<AmpSelfView, "self_digest" | "horizon">): string[] {
        const unknownText: string[] = selfBase.known_unknowns.map((item: AmpKnownUnknown): string => {
            return `${item.id} (voi ${item.voi.toFixed(2)})`;
        });
        const goalState: string = this.lifecycle === null ? "unknown" : this.lifecycle.state;
        const leaseMinutes: number = this.lease === null ? 0 : Math.max(0, Math.round((Date.parse(this.lease.expires) - Date.now()) / 60000));
        const reliability: string = selfBase.calibration.n > 0 && selfBase.calibration.brier !== null
            ? `brier ${selfBase.calibration.brier.toFixed(2)}`
            : "uncalibrated";
        return [
            `SELF ${SUBJECT}`,
            `intent ${this.intent}`,
            `goal ${this.lifecycle === null ? "none" : this.lifecycle.goal.statement} (${goalState})`,
            `lease ${this.lease === null ? "none" : this.lease.id} ${String(leaseMinutes)}m`,
            `budget tokens ${String(selfBase.attention.used.tokens)}/${String(selfBase.attention.budget.tokens)}`,
            `can ${verified.length > 0 ? verified.join(", ") : "none"}`,
            "may read/validate; write:* forbidden; publish requires grant",
            `reliability ${reliability} (n=${String(selfBase.calibration.n)})`,
            `unknown ${unknownText.join("; ")}`,
        ];
    }

    private chainSnapshot(): LedgerSnapshot {
        return exportLedger(this.ledger, AGENT_REF_ID);
    }

    private ledgerEntries(snapshot: LedgerSnapshot): AmpLedgerEntry[] {
        return snapshot.entries.map((entry: ChainEntry): AmpLedgerEntry => {
            return this.toLedgerEntry(entry);
        });
    }

    private toLedgerEntry(entry: ChainEntry): AmpLedgerEntry {
        if (entry.kind === "event") {
            const event: { at: string; type: string; payload?: Record<string, unknown> } = entry.payload as { at: string; type: string; payload?: Record<string, unknown> };
            const payload: LedgerPayload | undefined = event.payload === (void 0) ? (void 0) : (event.payload as unknown as LedgerPayload);
            if (payload !== (void 0)) {
                return {
                    seq: entry.seq + 1,
                    ts: payload.ts,
                    verb: payload.verb,
                    object: payload.object,
                    ref: payload.ref,
                    event: event.type,
                    cost: payload.cost,
                    prev_hash: entry.prev,
                    hash: entry.hash,
                };
            }
        }
        if (entry.kind === "receipt") {
            const receipt: Receipt = entry.payload as Receipt;
            const target: string = receipt.target === (void 0) ? receipt.id : receipt.target.id;
            return {
                seq: entry.seq + 1,
                ts: receipt.at,
                verb: receipt.op === "read" ? "resolve" : "act",
                object: target,
                ref: receipt.id,
                event: `receipt_${receipt.outcome}`,
                cost: costOfUsage(receipt.usage),
                prev_hash: entry.prev,
                hash: entry.hash,
            };
        }
        return {
            seq: entry.seq + 1,
            ts: "",
            verb: "declare",
            object: entry.kind,
            ref: entry.hash,
            event: `${entry.kind}_entry`,
            cost: zeroCost(),
            prev_hash: entry.prev,
            hash: entry.hash,
        };
    }

    private snapshot(): AmpSnapshot {
        if (this.world === null || this.values === null || this.lease === null || this.caps === null) {
            throw new Error("AMP engine is not initialized");
        }
        const chain: LedgerSnapshot = this.chainSnapshot();
        const handles: AmpHandleView[] = [...this.handleRecords.values()].map((record: HandleRecord): AmpHandleView => {
            return {
                id: record.handle.id,
                taint: record.taint,
                media: record.media,
                size: canonical(record.payload).length,
                created_at: record.created_at,
            };
        });
        const view: AmpSnapshot = {
            world: this.world,
            values: this.values,
            lease: this.lease,
            case: this.caseView(),
            ledger: this.ledgerEntries(chain),
            budget: { used: this.usedBudget(), caps: copyBudget(this.caps) },
            handles,
            grants: [...this.grants.values()],
            slice: this.slice,
            whyNot: this.whyNot,
            self: this.buildSelfView(),
            notice: this.notice,
        };
        if (this.latestHandle !== (void 0)) {
            view.latestHandle = this.latestHandle;
        }
        if (this.frameView !== (void 0)) {
            view.frame = this.frameView;
        }
        if (this.impact !== (void 0)) {
            view.impact = this.impact;
        }
        if (this.checkpoint !== (void 0)) {
            const checkpoint: AmpLedgerCheckpoint = {
                amp: "0.1",
                kind: "ledger-checkpoint",
                tenant: this.checkpoint.tenant,
                agent: this.checkpoint.agent,
                seq: this.checkpoint.seq,
                count: this.checkpoint.count,
                tip: this.checkpoint.tip,
                issued: this.checkpoint.issued,
                kid: this.checkpoint.kid,
                sig: this.checkpoint.sig,
            };
            if (this.checkpoint.prev !== (void 0)) {
                checkpoint.prev = this.checkpoint.prev;
            }
            view.ledger_checkpoint = checkpoint;
        }
        return view;
    }

    private respond(ok: boolean, error: AmpError | undefined, data: unknown): AmpResponse {
        return { ok, snapshot: this.snapshot(), error, data };
    }

    private fail(code: string, message: string): AmpResponse {
        return this.respond(false, { code, message }, (void 0));
    }

    private async appendLedger(verb: AmpVerb, object: string, event: string, cost: AmpCost): Promise<void> {
        this.requestSeq += 1;
        const now: string = new Date().toISOString();
        const payload: LedgerPayload = {
            ts: now,
            verb,
            object,
            ref: `req-${String(this.requestSeq)}`,
            event,
            cost: copyCost(cost),
        };
        const record: AmpEvent = {
            amp: "0.1",
            kind: "event",
            id: `evt.${String(this.requestSeq)}`,
            at: now,
            actor: { kind: "self", id: AGENT_REF_ID },
            type: event,
            digest: digestOf(payload),
            payload,
        };
        this.ledger.appendEvent(record);
        await this.sealLedger();
    }

    private async sealLedger(): Promise<void> {
        if (this.signingKey === null) {
            return;
        }
        const snapshot: LedgerSnapshot = this.chainSnapshot();
        const issued: string = new Date().toISOString();
        const checkpoint: LedgerCheckpoint = await sealCheckpoint(snapshot, this.signingKey, {
            tenant: TENANT,
            issued,
            previous: this.checkpoint,
        });
        this.checkpoint = checkpoint;
    }
}
