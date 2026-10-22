import {
    createHash,
    generateKeyPairSync,
    sign as signMessage,
    verify as verifyMessage,
    type KeyObject,
} from "node:crypto";
import {
    brierScore,
    expectedCalibrationError,
    makeBinaryLikelihood,
    updateBelief,
    updateBeta,
} from "./bayes";
import type {
    AmpAccountData,
    AmpAccountRequest,
    AmpActData,
    AmpActRequest,
    AmpAffordance,
    AmpBelief,
    AmpBetaPosterior,
    AmpBudget,
    AmpCalibrationSample,
    AmpCaseView,
    AmpClaim,
    AmpCost,
    AmpEffectKind,
    AmpError,
    AmpEvidence,
    AmpGrantView,
    AmpHandleView,
    AmpKnownUnknown,
    AmpLeaseView,
    AmpLedgerEntry,
    AmpLevel,
    AmpManifestView,
    AmpProcess,
    AmpReceipt,
    AmpResolveData,
    AmpResolveRequest,
    AmpResponse,
    AmpSelfCapability,
    AmpSelfView,
    AmpSliceItem,
    AmpSnapshot,
    AmpValuesView,
    AmpWhyNot,
    AmpVerb,
} from "./types";

const WORLD_ID: string = "amp://world/periodicity/calendar-import";
const PROCESS_ID: string = "p:calendar-import";
const SUBJECT: string = "agent:workflow-console";
const SELF_ID: string = "amp://self/agent:workflow-console";
const PRIMARY_SCOPE: string = "dataset:2026";
const ROLES: readonly string[] = ["role:analyst", "role:approver"];

interface StoredManifest extends AmpManifestView {
    amp: string;
    kind: string;
    signature: string;
    publisher: {
        id: string;
        key_id: string;
        alg: string;
    };
    scope: {
        tenant: string;
        audience: string[];
        purpose: string;
    };
}

interface StoredValues extends AmpValuesView {
    amp: string;
    kind: string;
    id: string;
    version: number;
    issued_at: string;
    signature: string;
    principal: string;
}

interface InternalHandle {
    id: string;
    taint: "trusted" | "untrusted" | "mixed";
    media: string;
    content: unknown;
    lineage: string[];
    created_at: string;
    expires: string;
}

interface CapabilityState {
    evidence: AmpEvidence[];
    receipts: string[];
    successes: number;
    failures: number;
}

function zeroResources(): AmpBudget["resources"] {
    return {
        usd: "0",
        compute_ms: 0,
        energy_wh: 0,
        human_items: 0,
    };
}

function zeroBudget(): AmpBudget {
    return {
        tokens: 0,
        time_ms: 0,
        space_bytes: 0,
        capability_load: 0,
        resources: zeroResources(),
        risk: 0,
    };
}

function zeroCost(): AmpCost {
    return {
        tokens: 0,
        time_ms: 0,
        space_bytes: 0,
        capability_load: 0,
        resources: zeroResources(),
        risk: 0,
    };
}

function makeCost(
    tokens: number,
    timeMs: number,
    spaceBytes: number,
    capabilityLoad: number,
    risk: number,
    humanItems: number = 0,
): AmpCost {
    return {
        tokens,
        time_ms: timeMs,
        space_bytes: spaceBytes,
        capability_load: capabilityLoad,
        resources: {
            usd: "0",
            compute_ms: timeMs,
            energy_wh: 0,
            human_items: humanItems,
        },
        risk,
    };
}

function canonicalize(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const primitive: string | undefined = JSON.stringify(value);
        return primitive ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item: unknown): string => {
            return canonicalize(item);
        }).join(",")}]`;
    }
    if (typeof value === "object") {
        const record: Record<string, unknown> = value as Record<string, unknown>;
        const keys: string[] = Object.keys(record)
            .filter((key: string): boolean => {
                return record[key] !== (void 0);
            })
            .sort();
        return `{${keys.map((key: string): string => {
            return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
        }).join(",")}}`;
    }
    return "null";
}

function digestValue(value: unknown): string {
    return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function isoAfter(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function shortDigest(digest: string): string {
    return digest.length > 20 ? `${digest.slice(0, 11)}…${digest.slice(-8)}` : digest;
}

function evidenceKey(effect: { kind: string; scope: string }): string {
    return `${effect.kind}:${effect.scope}`;
}

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

export class AmpEngine {
    private privateKey: KeyObject | null = null;
    private publicKey: KeyObject | null = null;
    private manifest: StoredManifest | null = null;
    private values: StoredValues | null = null;
    private lease: AmpLeaseView | null = null;
    private caseState: AmpCaseView | null = null;
    private ledger: AmpLedgerEntry[] = [];
    private handles: Map<string, InternalHandle> = new Map<string, InternalHandle>();
    private grants: Map<string, AmpGrantView> = new Map<string, AmpGrantView>();
    private capabilityStates: Map<string, CapabilityState> = new Map<string, CapabilityState>();
    private evidenceStore: Map<string, AmpEvidence> = new Map<string, AmpEvidence>();
    private used: AmpBudget = zeroBudget();
    private slice: AmpSliceItem[] = [];
    private whyNot: AmpWhyNot[] = [];
    private latestHandle: string | undefined = (void 0);
    private notice: string = "";
    private intent: string = "";
    private requestSeq: number = 0;
    private calibrationSamples: AmpCalibrationSample[] = [];

    public init(): AmpResponse {
        const keyPair: { publicKey: KeyObject; privateKey: KeyObject } = generateKeyPairSync("ed25519");
        this.privateKey = keyPair.privateKey;
        this.publicKey = keyPair.publicKey;
        this.ledger = [];
        this.handles = new Map<string, InternalHandle>();
        this.grants = new Map<string, AmpGrantView>();
        this.capabilityStates = new Map<string, CapabilityState>();
        this.evidenceStore = new Map<string, AmpEvidence>();
        this.used = zeroBudget();
        this.slice = [];
        this.whyNot = [];
        this.latestHandle = (void 0);
        this.requestSeq = 0;
        this.calibrationSamples = [];
        this.intent = "准备导入 2026 年历法数据，检查行数与 schema";

        const now: string = new Date().toISOString();
        const validUntil: string = isoAfter(60 * 60 * 1000);
        const initial: { claims: AmpClaim[]; evidence: AmpEvidence[] } = this.createInitialClaims(now, validUntil);
        const affordances: AmpAffordance[] = this.createAffordances();
        const process: AmpProcess = this.createProcess();
        const manifestBase: Omit<StoredManifest, "digest" | "signature"> = {
            amp: "0.1",
            kind: "manifest",
            id: WORLD_ID,
            version: 1,
            issued_at: now,
            valid_until: validUntil,
            publisher: {
                id: "did:web:periodicity.local",
                key_id: "dev-2026-10",
                alg: "Ed25519",
            },
            scope: {
                tenant: "periodicity",
                audience: ["workflow-console"],
                purpose: "calendar-import",
            },
            claims: initial.claims,
            affordances,
            process,
        };
        const manifestDigest: string = digestValue(manifestBase);
        const manifestSignature: string = this.signDigest(manifestDigest);
        const manifest: StoredManifest = {
            ...manifestBase,
            digest: manifestDigest,
            signature: manifestSignature,
        };
        if (!this.verifyDigest(manifestDigest, manifestSignature)) {
            throw new Error("manifest signature self-check failed");
        }
        this.manifest = manifest;
        for (const evidence of initial.evidence) {
            this.evidenceStore.set(evidence.id, evidence);
        }

        const caps: AmpBudget = {
            tokens: 20000,
            time_ms: 60000,
            space_bytes: 1048576,
            capability_load: 10,
            resources: {
                usd: "0.02",
                compute_ms: 5000,
                energy_wh: 1,
                human_items: 5,
            },
            risk: 0.9,
        };
        const weights: AmpBudget = {
            tokens: 1,
            time_ms: 1,
            space_bytes: 1,
            capability_load: 1,
            resources: {
                usd: "1",
                compute_ms: 1,
                energy_wh: 1,
                human_items: 1,
            },
            risk: 1,
        };
        const approvalEffects: AmpEffectKind[] = ["irreversible", "spend"];
        const valuesBase: Omit<StoredValues, "digest" | "signature"> = {
            amp: "0.1",
            kind: "values",
            id: `amp://values/${SUBJECT}`,
            version: 1,
            principal: "did:web:periodicity.local",
            issued_at: now,
            caps,
            weights: {
                value: weights,
                cost: weights,
            },
            approval: {
                effects: approvalEffects,
            },
        };
        const valuesDigest: string = digestValue(valuesBase);
        const valuesSignature: string = this.signDigest(valuesDigest);
        const values: StoredValues = {
            ...valuesBase,
            digest: valuesDigest,
            signature: valuesSignature,
            weights: {
                value: weights,
                cost: weights,
            },
            caps,
            approval: {
                effects: approvalEffects,
            },
        };
        if (!this.verifyDigest(valuesDigest, valuesSignature)) {
            throw new Error("values signature self-check failed");
        }
        this.values = values;

        this.lease = {
            id: "l:calendar-import-2026",
            subject: SUBJECT,
            scope: [WORLD_ID, PRIMARY_SCOPE],
            ops: ["declare", "attend", "act", "resolve", "account"],
            budget: caps,
            issued_at: now,
            expires: isoAfter(15 * 60 * 1000),
        };
        this.caseState = {
            id: "case:calendar-2026-01",
            process: PROCESS_ID,
            state: "open",
            stepIndex: 0,
            grants: [],
        };
        for (const affordance of affordances) {
            this.capabilityStates.set(affordance.id, {
                evidence: [],
                receipts: [],
                successes: 0,
                failures: 0,
            });
        }
        this.appendLedger("declare", WORLD_ID, "manifest_declared", zeroCost());
        const built: { slice: AmpSliceItem[]; whyNot: AmpWhyNot[] } = this.buildSlice(this.intent, "L1");
        this.slice = built.slice;
        this.whyNot = built.whyNot;
        this.notice = "世界已声明；初始注意力切片已生成；等待第一次 act。";
        return this.respond(true, (void 0), (void 0));
    }

    public attend(intent: string, level: AmpLevel): AmpResponse {
        if (!this.isReady()) {
            return this.init();
        }
        if (typeof intent !== "string" || intent.trim().length === 0) {
            return this.fail("SCHEMA_INVALID", "intent must be a non-empty string");
        }
        const validLevels: readonly AmpLevel[] = ["L0", "L1", "L2"];
        if (!validLevels.includes(level)) {
            return this.fail("SCHEMA_INVALID", `unsupported attention level: ${String(level)}`);
        }
        const cost: AmpCost = makeCost(180, 10, 1024, 1, 0.01);
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", "attention budget exceeded");
        }
        this.charge(cost);
        this.intent = intent;
        const built: { slice: AmpSliceItem[]; whyNot: AmpWhyNot[] } = this.buildSlice(intent, level);
        this.slice = built.slice;
        this.whyNot = built.whyNot;
        this.appendLedger("attend", intent, "attention_slice", cost);
        this.notice = `注意力切片已更新：${String(this.slice.length)} 条，消耗 ${String(cost.tokens)} tokens。`;
        return this.respond(true, (void 0), (void 0));
    }

    public act(request: AmpActRequest): AmpResponse {
        if (!this.isReady()) {
            return this.init();
        }
        const step: AmpProcess["steps"][number] | undefined = this.currentStep();
        if (!step) {
            return this.fail("CASE_CLOSED", "the process case is already closed");
        }
        const affordance: AmpAffordance | undefined = this.findAffordance(request.affordance);
        if (!affordance) {
            return this.fail("SCHEMA_INVALID", `unknown affordance: ${String(request.affordance)}`);
        }
        if (affordance.id !== step.affordance) {
            return this.fail("GATE_NOT_READY", `expected ${step.affordance}, got ${affordance.id}`);
        }
        const expectedAck: string[] = affordance.effects.map((effect): string => {
            return evidenceKey(effect);
        });
        const ack: string[] = Array.isArray(request.effectsAck) ? request.effectsAck : [];
        const missingAck: string[] = expectedAck.filter((key: string): boolean => {
            return !ack.includes(key);
        });
        if (missingAck.length > 0) {
            return this.fail("EFFECT_UNDECLARED", `effects not acknowledged: ${missingAck.join(", ")}`);
        }
        const permitted: boolean = affordance.permissions.every((permission: string): boolean => {
            return ROLES.includes(permission);
        });
        if (!permitted) {
            return this.fail("PERMISSION_DENIED", "role intersection is empty");
        }
        const needsGrant: boolean = affordance.effects.some((effect): boolean => {
            return effect.kind === "irreversible" || effect.kind === "spend";
        });
        const grant: AmpGrantView | undefined = request.approval
            ? this.grants.get(request.approval)
            : (void 0);
        if (needsGrant && (!grant || !this.isGrantValid(grant))) {
            return this.fail("APPROVAL_REQUIRED", "a valid grant is required for this action");
        }
        const cost: AmpCost = affordance.cost;
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", "execution budget exceeded");
        }
        this.charge(cost);

        let handleId: string = "";
        let effectKind: AmpAffordance["effects"][number]["kind"] = "read";
        if (affordance.id === "a:read_dataset") {
            handleId = this.createHandle(
                {
                    dataset: "calendar-2026",
                    rows: 1280,
                    columns: ["date", "event", "lunar_date"],
                    sample: [
                        { date: "2026-01-01", event: "元旦", lunar_date: "冬月十三" },
                        { date: "2026-02-17", event: "春节", lunar_date: "正月初一" },
                    ],
                },
                "trusted",
                [affordance.id],
                "application/json",
            );
            effectKind = "read";
        } else if (affordance.id === "a:validate_dataset") {
            this.addConflictClaim();
            handleId = this.createHandle(
                {
                    status: "mismatch",
                    expected_rows: 1280,
                    observed_rows: 1284,
                    blocking_claim: "c:row-count-conflict",
                    schema: "calendar-v3",
                },
                "trusted",
                [affordance.id],
                "application/amp+json",
            );
            effectKind = "read";
        } else if (affordance.id === "a:approve_publish") {
            const grantHandle: string = this.createHandle(
                {
                    case_id: this.caseState?.id,
                    step: "03_approve",
                    scope: "publish:dataset:2026",
                    evidence: ["c:row-count-conflict"],
                },
                "trusted",
                [affordance.id],
                "application/amp+json",
            );
            const createdGrant: AmpGrantView = {
                id: `g:${this.caseState?.id ?? "case"}:03_approve`,
                handle: grantHandle,
                caseId: this.caseState?.id ?? "case",
                step: "03_approve",
                expires: this.lease?.expires ?? isoAfter(15 * 60 * 1000),
            };
            this.grants.set(grantHandle, createdGrant);
            this.caseState?.grants.push(grantHandle);
            handleId = grantHandle;
            effectKind = "grant";
        } else if (affordance.id === "a:publish_result") {
            if (!grant || !this.isGrantValid(grant)) {
                return this.fail("APPROVAL_REQUIRED", "publish requires a valid grant");
            }
            handleId = this.createHandle(
                {
                    published: true,
                    dataset: "calendar-2026",
                    rows: 1284,
                    path: "dist/calendar-2026.json",
                },
                "trusted",
                [affordance.id, grant.handle],
                "application/json",
            );
            effectKind = "irreversible";
        } else {
            return this.fail("SCHEMA_INVALID", `no executor for ${affordance.id}`);
        }

        this.latestHandle = handleId;
        this.recordReceipt(affordance.id, handleId);
        this.advanceCase(affordance.id);
        this.appendLedger("act", affordance.id, `${affordance.id}_applied`, cost);
        this.notice = `${affordance.title} 已执行；receipt ${shortDigest(handleId)}。`;

        const receipt: AmpReceipt = {
            effect: effectKind,
            scope: affordance.effects[0]?.scope ?? PRIMARY_SCOPE,
            status: "applied",
            applied_at: new Date().toISOString(),
            evidence: handleId,
        };
        const data: AmpActData = {
            handle: handleId,
            receipt,
        };
        return this.respond(true, (void 0), data);
    }

    public resolve(request: AmpResolveRequest): AmpResponse {
        if (!this.isReady()) {
            return this.init();
        }
        const handle: InternalHandle | undefined = this.handles.get(request.handle);
        if (!handle) {
            return this.fail("SCHEMA_INVALID", `unknown handle: ${String(request.handle)}`);
        }
        if (Date.parse(handle.expires) < Date.now()) {
            return this.fail("HANDLE_EXPIRED", "handle expired");
        }
        const projections: readonly string[] = ["summary", "rows", "fields"];
        if (!projections.includes(request.projection)) {
            return this.fail("SCHEMA_INVALID", `unsupported projection: ${String(request.projection)}`);
        }
        const data: unknown = this.project(handle.content, request.projection);
        const estimated: number = Math.max(1, Math.ceil(canonicalize(data).length / 4));
        const maxTokens: number = Math.max(1, request.maxTokens ?? 4000);
        if (estimated > maxTokens) {
            return this.fail("BUDGET_EXCEEDED", `projection requires ${String(estimated)} tokens, max ${String(maxTokens)}`);
        }
        const cost: AmpCost = makeCost(estimated, 5, 2048, 1, 0);
        if (!this.fitsBudget(cost)) {
            return this.fail("BUDGET_EXCEEDED", "resolve budget exceeded");
        }
        this.charge(cost);
        this.latestHandle = handle.id;
        this.appendLedger("resolve", handle.id, `projection_${request.projection}`, cost);
        this.notice = `句柄已投影：${request.projection}，约 ${String(estimated)} tokens。`;
        const payload: AmpResolveData = {
            handle: handle.id,
            projection: request.projection,
            data,
            lineage: handle.lineage,
            taint: handle.taint,
            cost,
        };
        return this.respond(true, (void 0), payload);
    }

    public account(request: AmpAccountRequest): AmpResponse {
        if (!this.isReady()) {
            return this.init();
        }
        const outcomes: readonly string[] = ["success", "failure", "unknown"];
        if (!outcomes.includes(request.outcome)) {
            return this.fail("SCHEMA_INVALID", `unsupported outcome: ${String(request.outcome)}`);
        }
        const cost: AmpCost = zeroCost();
        this.appendLedger("account", request.ref, `outcome_${request.outcome}`, cost);
        this.notice = `已结算 ${request.ref}：${request.outcome}。`;
        const data: AmpAccountData = {
            balance: copyBudget(this.used),
            entries: this.ledger.length,
        };
        return this.respond(true, (void 0), data);
    }

    private isReady(): boolean {
        return this.manifest !== null
            && this.values !== null
            && this.lease !== null
            && this.caseState !== null;
    }

    private currentStep(): AmpProcess["steps"][number] | undefined {
        if (!this.manifest || !this.caseState) {
            return (void 0);
        }
        return this.manifest.process.steps[this.caseState.stepIndex];
    }

    private findAffordance(id: string): AmpAffordance | undefined {
        return this.manifest?.affordances.find((affordance: AmpAffordance): boolean => {
            return affordance.id === id;
        });
    }

    private isGrantValid(grant: AmpGrantView): boolean {
        return grant.caseId === this.caseState?.id
            && grant.step === "03_approve"
            && Date.parse(grant.expires) > Date.now();
    }

    private createInitialClaims(now: string, validUntil: string): { claims: AmpClaim[]; evidence: AmpEvidence[] } {
        const fsEvidence: AmpEvidence = this.makeEvidence("e:fs-stat", "runtime:fs", "stat", now, "positive");
        const countEvidence: AmpEvidence = this.makeEvidence("e:source-count", "runtime:source", "count", now, "positive");
        const schemaEvidence: AmpEvidence = this.makeEvidence("e:schema-check", "runtime:schema", "validate", now, "positive");
        const claims: AmpClaim[] = [
            this.makeClaim({
                id: "c:dataset-2026-exists",
                subject: PRIMARY_SCOPE,
                predicate: "exists",
                object: true,
                prior: 0.9,
                priorSource: "base-rate:dataset/exists/v1",
                evidence: [fsEvidence],
                observedAt: now,
                validUntil,
            }),
            this.makeClaim({
                id: "c:dataset-2026-rows",
                subject: PRIMARY_SCOPE,
                predicate: "row_count",
                object: 1280,
                prior: 0.85,
                priorSource: "base-rate:dataset/row-count/v1",
                evidence: [countEvidence],
                observedAt: now,
                validUntil,
            }),
            this.makeClaim({
                id: "c:dataset-2026-schema",
                subject: PRIMARY_SCOPE,
                predicate: "schema",
                object: "calendar-v3",
                prior: 0.8,
                priorSource: "base-rate:dataset/schema/v1",
                evidence: [schemaEvidence],
                observedAt: now,
                validUntil,
            }),
        ];
        return {
            claims,
            evidence: [fsEvidence, countEvidence, schemaEvidence],
        };
    }

    private makeEvidence(
        id: string,
        source: string,
        method: string,
        observedAt: string,
        outcome: "positive" | "negative",
    ): AmpEvidence {
        return {
            id,
            source,
            method,
            observed_at: observedAt,
            taint: "trusted",
            outcome,
            likelihood: makeBinaryLikelihood(0.96, 0.08),
            calibration: {
                n: 100,
                auc: 0.93,
                brier: 0.06,
                ece: 0.04,
                updated_at: observedAt,
            },
            depends_on: [],
        };
    }

    private makeClaim(input: {
        id: string;
        subject: string;
        predicate: string;
        object: unknown;
        prior: number;
        priorSource: string;
        evidence: AmpEvidence[];
        observedAt: string;
        validUntil: string;
        conflictsWith?: string[];
    }): AmpClaim {
        const belief: AmpBelief = updateBelief(input.prior, input.priorSource, input.evidence, { rho: 0 });
        return {
            id: input.id,
            subject: input.subject,
            predicate: input.predicate,
            object: input.object,
            confidence: belief.posterior,
            belief,
            observed_at: input.observedAt,
            valid_until: input.validUntil,
            provenance: {
                source: input.evidence[0]?.source ?? "runtime",
                method: input.evidence[0]?.method ?? "declared",
                evidence: input.evidence.map((evidence: AmpEvidence): string => {
                    return evidence.id;
                }),
            },
            taint: "trusted",
            conflicts_with: input.conflictsWith,
        };
    }

    private addConflictClaim(): void {
        if (!this.manifest) {
            return;
        }
        if (this.manifest.claims.some((claim: AmpClaim): boolean => {
            return claim.id === "c:row-count-conflict";
        })) {
            return;
        }
        const now: string = new Date().toISOString();
        const evidence: AmpEvidence = {
            ...this.makeEvidence("e:validation-recount", "runtime:validator", "recount", now, "positive"),
            likelihood: makeBinaryLikelihood(0.92, 0.05),
        };
        this.evidenceStore.set(evidence.id, evidence);
        const claim: AmpClaim = this.makeClaim({
            id: "c:row-count-conflict",
            subject: PRIMARY_SCOPE,
            predicate: "row_count_conflict",
            object: {
                expected: 1280,
                observed: 1284,
            },
            prior: 0.5,
            priorSource: "base-rate:validation/mismatch/v1",
            evidence: [evidence],
            observedAt: now,
            validUntil: this.lease?.expires ?? isoAfter(15 * 60 * 1000),
            conflictsWith: ["c:dataset-2026-rows"],
        });
        this.manifest.claims.push(claim);
    }

    private recordReceipt(affordanceId: string, handle: string): void {
        const state: CapabilityState = this.capabilityState(affordanceId);
        const prior: number = this.capabilityPrior(affordanceId);
        const before: AmpBelief = updateBelief(
            prior,
            `base-rate:affordance/${affordanceId}/v1`,
            state.evidence,
            { rho: 0.2 },
        );
        this.calibrationSamples.push({
            probability: before.posterior,
            outcome: 1,
        });
        const evidence: AmpEvidence = this.makeEvidence(
            `e:receipt-${String(this.ledger.length + 1)}-${affordanceId.replace(/[^a-z0-9]/gi, "-")}`,
            "runtime:executor",
            "receipt",
            new Date().toISOString(),
            "positive",
        );
        state.evidence.push(evidence);
        this.evidenceStore.set(evidence.id, evidence);
        state.receipts.push(handle);
        state.successes += 1;
    }

    private capabilityState(id: string): CapabilityState {
        const existing: CapabilityState | undefined = this.capabilityStates.get(id);
        if (existing) {
            return existing;
        }
        const created: CapabilityState = {
            evidence: [],
            receipts: [],
            successes: 0,
            failures: 0,
        };
        this.capabilityStates.set(id, created);
        return created;
    }

    private advanceCase(affordanceId: string): void {
        if (!this.caseState || !this.manifest) {
            return;
        }
        this.caseState.stepIndex += 1;
        if (affordanceId === "a:publish_result" || this.caseState.stepIndex >= this.manifest.process.steps.length) {
            this.caseState.state = "completed";
        }
    }

    private createHandle(
        content: unknown,
        taint: InternalHandle["taint"],
        lineage: string[],
        media: string,
    ): string {
        const id: string = `amp://h/${digestValue(content)}`;
        const handle: InternalHandle = {
            id,
            taint,
            media,
            content,
            lineage,
            created_at: new Date().toISOString(),
            expires: isoAfter(10 * 60 * 1000),
        };
        this.handles.set(id, handle);
        return id;
    }

    private project(content: unknown, projection: string): unknown {
        if (projection === "rows") {
            return content;
        }
        if (projection === "fields") {
            if (content !== null && typeof content === "object" && !Array.isArray(content)) {
                const record: Record<string, unknown> = content as Record<string, unknown>;
                const keys: string[] = Object.keys(record).slice(0, 6);
                const fields: Record<string, unknown> = {};
                for (const key of keys) {
                    fields[key] = record[key];
                }
                return fields;
            }
            return content;
        }
        if (content !== null && typeof content === "object" && !Array.isArray(content)) {
            const record: Record<string, unknown> = content as Record<string, unknown>;
            const summary: Record<string, unknown> = {};
            for (const key of Object.keys(record)) {
                const value: unknown = record[key];
                if (Array.isArray(value)) {
                    summary[key] = {
                        count: value.length,
                        first: value[0],
                    };
                } else if (typeof value === "string" && value.length > 120) {
                    summary[key] = `${value.slice(0, 117)}...`;
                } else {
                    summary[key] = value;
                }
            }
            return summary;
        }
        return content;
    }

    private buildSlice(intent: string, level: AmpLevel): { slice: AmpSliceItem[]; whyNot: AmpWhyNot[] } {
        if (!this.manifest) {
            return { slice: [], whyNot: [] };
        }
        const currentAffordance: string | undefined = this.currentStep()?.affordance;
        const candidates: Array<{ item: AmpSliceItem; score: number }> = [];
        for (const claim of this.manifest.claims) {
            const relevance: number = this.relevance(`${claim.predicate} ${claim.subject}`, intent);
            const V: number = clamp01(claim.confidence);
            const C: number = 0.02;
            const trust: number = claim.taint === "trusted" ? 1 : 0.35;
            const fresh: number = 1;
            const diversity: number = 1;
            const score: number = (V * relevance * trust * fresh * diversity) / (1 + C);
            const item: AmpSliceItem = {
                kind: "claim",
                id: claim.id,
                level,
                line: `${claim.id} ${claim.predicate}=${canonicalize(claim.object)} conf=${claim.confidence.toFixed(2)} taint=${claim.taint}`,
                value: score,
                components: {
                    V,
                    C,
                    relevance,
                    trust,
                    fresh,
                    diversity,
                },
            };
            candidates.push({ item, score });
        }
        for (const affordance of this.manifest.affordances) {
            const relevanceBase: number = this.relevance(`${affordance.title} ${affordance.intent}`, intent);
            const bonus: number = affordance.id === currentAffordance ? 0.2 : 0;
            const relevance: number = clamp01(relevanceBase + bonus);
            const V: number = clamp01(1 - affordance.cost.risk);
            const C: number = affordance.cost.tokens / 1000 + affordance.cost.risk;
            const trust: number = 1;
            const fresh: number = 1;
            const diversity: number = 1;
            const score: number = (V * relevance * trust * fresh * diversity) / (1 + C);
            const item: AmpSliceItem = {
                kind: "affordance",
                id: affordance.id,
                level,
                line: `${affordance.id} ${affordance.title} effects=${affordance.effects.map((effect): string => {
                    return evidenceKey(effect);
                }).join("/")} cost=${String(affordance.cost.tokens)}t risk=${String(affordance.cost.risk)}`,
                value: score,
                components: {
                    V,
                    C,
                    relevance,
                    trust,
                    fresh,
                    diversity,
                },
            };
            candidates.push({ item, score });
        }
        candidates.sort((left, right): number => {
            return right.score - left.score;
        });
        const limit: number = level === "L0" ? 3 : level === "L1" ? 6 : 8;
        const slice: AmpSliceItem[] = candidates.slice(0, limit).map((candidate): AmpSliceItem => {
            return candidate.item;
        });
        const whyNot: AmpWhyNot[] = candidates.slice(limit).map((candidate): AmpWhyNot => {
            return {
                id: candidate.item.id,
                reason: "outside attention budget / lower amp-attn score",
            };
        });
        return { slice, whyNot };
    }

    private relevance(text: string, intent: string): number {
        const keywords: readonly string[] = ["导入", "历法", "数据", "校验", "发布", "读取", "行数", "schema"];
        const matches: number = keywords.filter((keyword: string): boolean => {
            return intent.includes(keyword) || text.includes(keyword);
        }).length;
        return clamp01(0.35 + matches * 0.12);
    }

    private fitsBudget(cost: AmpCost): boolean {
        if (!this.lease) {
            return false;
        }
        const cap: AmpBudget = this.lease.budget;
        return this.used.tokens + cost.tokens <= cap.tokens
            && this.used.time_ms + cost.time_ms <= cap.time_ms
            && this.used.space_bytes + cost.space_bytes <= cap.space_bytes
            && this.used.capability_load + cost.capability_load <= cap.capability_load
            && Number(this.used.resources.usd) + Number(cost.resources.usd) <= Number(cap.resources.usd)
            && this.used.resources.compute_ms + cost.resources.compute_ms <= cap.resources.compute_ms
            && this.used.resources.energy_wh + cost.resources.energy_wh <= cap.resources.energy_wh
            && this.used.resources.human_items + cost.resources.human_items <= cap.resources.human_items
            && this.used.risk + cost.risk <= cap.risk;
    }

    private charge(cost: AmpCost): void {
        this.used.tokens += cost.tokens;
        this.used.time_ms += cost.time_ms;
        this.used.space_bytes += cost.space_bytes;
        this.used.capability_load += cost.capability_load;
        this.used.resources.usd = (Number(this.used.resources.usd) + Number(cost.resources.usd)).toFixed(2);
        this.used.resources.compute_ms += cost.resources.compute_ms;
        this.used.resources.energy_wh += cost.resources.energy_wh;
        this.used.resources.human_items += cost.resources.human_items;
        this.used.risk = Math.min(1, this.used.risk + cost.risk);
    }

    private appendLedger(verb: AmpVerb, object: string, event: string, cost: AmpCost): void {
        this.requestSeq += 1;
        const previous: AmpLedgerEntry | undefined = this.ledger[this.ledger.length - 1];
        const entryBase: Omit<AmpLedgerEntry, "hash"> = {
            seq: this.requestSeq,
            ts: new Date().toISOString(),
            verb,
            object,
            ref: `req-${String(this.requestSeq)}`,
            event,
            cost,
            prev_hash: previous?.hash ?? "genesis",
        };
        const entry: AmpLedgerEntry = {
            ...entryBase,
            hash: digestValue(entryBase),
        };
        this.ledger.push(entry);
    }

    private buildSelfView(): AmpSelfView | undefined {
        if (!this.manifest || !this.lease || !this.caseState || !this.values) {
            return (void 0);
        }
        const selfClaims: AmpClaim[] = [];
        const selfEvidence: AmpEvidence[] = [];
        const capabilities: AmpSelfCapability[] = [];
        const now: string = new Date().toISOString();
        for (const affordance of this.manifest.affordances) {
            const state: CapabilityState = this.capabilityState(affordance.id);
            const prior: number = this.capabilityPrior(affordance.id);
            const belief: AmpBelief = updateBelief(
                prior,
                `base-rate:affordance/${affordance.id}/v1`,
                state.evidence,
                { rho: 0.2 },
            );
            for (const evidence of state.evidence) {
                selfEvidence.push(evidence);
            }
            const verified: boolean = state.receipts.length > 0;
            const reliability: AmpBetaPosterior = updateBeta({ mu: 0.75, kappa: 10 }, state.successes, state.failures);
            const permission: boolean = affordance.permissions.every((item: string): boolean => {
                return ROLES.includes(item);
            });
            const needsGrant: boolean = affordance.effects.some((effect): boolean => {
                return effect.kind === "irreversible" || effect.kind === "spend";
            });
            const grantAvailable: boolean = this.hasGrantForCurrentCase();
            const leaseValid: boolean = Date.parse(this.lease.expires) > Date.now();
            const budgetOk: boolean = this.fitsBudget(affordance.cost);
            const caseOpen: boolean = this.caseState.state === "open";
            const availableNow: boolean = caseOpen && permission && leaseValid && budgetOk && (!needsGrant || grantAvailable);
            let reasonUnavailable: string | undefined = (void 0);
            if (!caseOpen) {
                reasonUnavailable = "case completed";
            } else if (!permission) {
                reasonUnavailable = "permission intersection empty";
            } else if (!leaseValid) {
                reasonUnavailable = "lease expired";
            } else if (!budgetOk) {
                reasonUnavailable = "budget insufficient";
            } else if (needsGrant && !grantAvailable) {
                reasonUnavailable = "grant required";
            }
            const capability: AmpSelfCapability = {
                affordance: affordance.id,
                label: affordance.title,
                verified,
                verification: verified ? "receipt" : "declared",
                last_receipt: state.receipts[state.receipts.length - 1],
                confidence: belief.posterior,
                belief,
                evidence: state.evidence.map((evidence: AmpEvidence): string => {
                    return evidence.id;
                }),
                reliability: {
                    prior: { mu: 0.75, kappa: 10 },
                    posterior: reliability,
                },
                available_now: availableNow,
                reason_unavailable: reasonUnavailable,
            };
            capabilities.push(capability);
            selfClaims.push({
                id: `c:self-${affordance.id.replace(/[^a-z0-9]/gi, "-")}`,
                subject: SELF_ID,
                predicate: "can_execute",
                object: {
                    affordance: affordance.id,
                    verification: capability.verification,
                },
                confidence: belief.posterior,
                belief,
                observed_at: now,
                valid_until: this.lease.expires,
                provenance: {
                    source: verified ? "runtime:executor" : "runtime:manifest",
                    method: verified ? "receipt" : "declared",
                    evidence: capability.evidence,
                },
                taint: "trusted",
            });
        }
        const calibration: AmpSelfView["calibration"] = this.buildCalibration();
        const knownUnknowns: AmpKnownUnknown[] = this.buildKnownUnknowns();
        const failures: AmpSelfView["failure_modes"] = this.buildFailureModes();
        const sliceSize: number = this.slice.length;
        const contextUtilization: number = clamp01(this.used.tokens / this.lease.budget.tokens);
        const selfBase: Omit<AmpSelfView, "self_digest" | "horizon"> = {
            subject: SELF_ID,
            identity: {
                model_id: "amp-host/0.1-draft",
                runtime_version: "0.1.1-draft",
                principal: "did:web:periodicity.local",
                values_digest: this.values.digest,
                manifest_digest: this.manifest.digest,
                lease_id: this.lease.id,
                issued_at: this.lease.issued_at,
            },
            claims: selfClaims,
            evidence: selfEvidence,
            capabilities,
            permissions: {
                may: ["read:dataset:2026", "validate:dataset:2026", "grant:03_approve"],
                must_not: ["write:*"],
                requires_approval: ["publish:dataset:2026"],
                boundaries: ["publish requires grant:03_approve"],
            },
            attention: {
                intent: this.intent,
                budget: copyBudget(this.lease.budget),
                used: copyBudget(this.used),
                context_utilization: contextUtilization,
                slice_size: sliceSize,
                lease_expires: this.lease.expires,
            },
            calibration,
            known_unknowns: knownUnknowns,
            failure_modes: failures,
            last_receipts: capabilities.flatMap((capability: AmpSelfCapability): string[] => {
                return capability.last_receipt ? [capability.last_receipt] : [];
            }),
            ledger_cursor: this.ledger.length,
        };
        const horizon: string[] = this.buildHorizon(selfBase);
        const withHorizon: Omit<AmpSelfView, "self_digest"> = {
            ...selfBase,
            horizon,
        };
        const selfDigest: string = digestValue(withHorizon);
        return {
            ...withHorizon,
            self_digest: selfDigest,
        };
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

    private hasGrantForCurrentCase(): boolean {
        if (!this.caseState) {
            return false;
        }
        return this.caseState.grants.some((handle: string): boolean => {
            const grant: AmpGrantView | undefined = this.grants.get(handle);
            return grant !== (void 0) && this.isGrantValid(grant);
        });
    }

    private buildCalibration(): AmpSelfView["calibration"] {
        if (this.calibrationSamples.length === 0) {
            return {
                brier: null,
                ece: null,
                auc: null,
                n: 0,
                by_domain: {},
            };
        }
        return {
            brier: brierScore(this.calibrationSamples),
            ece: expectedCalibrationError(this.calibrationSamples),
            auc: null,
            n: this.calibrationSamples.length,
            by_domain: {
                dataset: {
                    brier: brierScore(this.calibrationSamples) ?? 0,
                    ece: expectedCalibrationError(this.calibrationSamples) ?? 0,
                    n: this.calibrationSamples.length,
                },
            },
        };
    }

    private buildKnownUnknowns(): AmpKnownUnknown[] {
        const conflict: boolean = this.manifest?.claims.some((claim: AmpClaim): boolean => {
            return claim.id === "c:row-count-conflict";
        }) ?? false;
        const unknowns: AmpKnownUnknown[] = [];
        if (conflict) {
            unknowns.push({
                id: "u:row-count-conflict",
                question: "源文件行数是 1280、校验结果是 1284，哪一个正确？",
                voi: 0.9,
                evidence_needed: ["receipt:recount", "claim:row-count-conflict"],
                blocking: true,
            });
        } else {
            unknowns.push({
                id: "u:row-count",
                question: "源文件行数是否与声明一致？",
                voi: 0.82,
                evidence_needed: ["affordance:validate_dataset"],
                blocking: true,
            });
        }
        unknowns.push({
            id: "u:schema-compat",
            question: "calendar-v3 schema 是否兼容当前发布器？",
            voi: 0.41,
            evidence_needed: ["claim:schema-check"],
            blocking: false,
        });
        return unknowns;
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

    private buildHorizon(self: {
        capabilities: AmpSelfCapability[];
        known_unknowns: AmpKnownUnknown[];
        calibration: AmpSelfView["calibration"];
        attention: AmpSelfView["attention"];
    }): string[] {
        const verified: string[] = self.capabilities
            .filter((capability: AmpSelfCapability): boolean => {
                return capability.verified;
            })
            .map((capability: AmpSelfCapability): string => {
                return capability.affordance;
            });
        const unknown: string[] = self.known_unknowns.map((item: AmpKnownUnknown): string => {
            return `${item.id} (voi ${item.voi.toFixed(2)})`;
        });
        return [
            `SELF ${SUBJECT}`,
            `intent ${this.intent}`,
            `lease ${this.lease?.id ?? "none"} ${this.lease ? String(Math.max(0, Math.round((Date.parse(this.lease.expires) - Date.now()) / 60000))) : "0"}m`,
            `budget tokens ${String(this.used.tokens)}/${String(self.attention.budget.tokens)}`,
            `can ${verified.length > 0 ? verified.join(", ") : "none"}`,
            "may read/validate; write:* forbidden; publish requires grant",
            `reliability ${self.calibration.n > 0 ? `brier ${(self.calibration.brier ?? 0).toFixed(2)}` : "uncalibrated"} (n=${String(self.calibration.n)})`,
            `unknown ${unknown.join("; ")}`,
        ];
    }

    private snapshot(): AmpSnapshot {
        if (!this.manifest || !this.values || !this.lease || !this.caseState) {
            throw new Error("AMP engine is not initialized");
        }
        const handles: AmpHandleView[] = [...this.handles.values()].map((handle: InternalHandle): AmpHandleView => {
            return {
                id: handle.id,
                taint: handle.taint,
                media: handle.media,
                size: canonicalize(handle.content).length,
                created_at: handle.created_at,
            };
        });
        return {
            world: {
                id: this.manifest.id,
                version: this.manifest.version,
                digest: this.manifest.digest,
                issued_at: this.manifest.issued_at,
                valid_until: this.manifest.valid_until,
                claims: this.manifest.claims,
                affordances: this.manifest.affordances,
                process: this.manifest.process,
            },
            values: {
                digest: this.values.digest,
                weights: this.values.weights,
                caps: this.values.caps,
                approval: this.values.approval,
            },
            lease: this.lease,
            case: this.caseState,
            ledger: [...this.ledger],
            budget: {
                used: copyBudget(this.used),
                caps: copyBudget(this.lease.budget),
            },
            handles,
            grants: [...this.grants.values()],
            slice: this.slice,
            whyNot: this.whyNot,
            self: this.buildSelfView(),
            latestHandle: this.latestHandle,
            notice: this.notice,
        };
    }

    private respond(ok: boolean, error: AmpError | undefined, data: unknown): AmpResponse {
        return {
            ok,
            snapshot: this.snapshot(),
            error,
            data,
        };
    }

    private fail(code: string, message: string): AmpResponse {
        return this.respond(false, { code, message }, (void 0));
    }

    private signDigest(digest: string): string {
        if (!this.privateKey) {
            throw new Error("private key missing");
        }
        return signMessage(null, Buffer.from(digest), this.privateKey).toString("base64url");
    }

    private verifyDigest(digest: string, signature: string): boolean {
        if (!this.publicKey) {
            return false;
        }
        return verifyMessage(null, Buffer.from(digest), this.publicKey, Buffer.from(signature, "base64url"));
    }

    private createAffordances(): AmpAffordance[] {
        return [
            {
                id: "a:read_dataset",
                title: "读取数据",
                intent: "读取 2026 年历法数据集，取得行数与字段样例。",
                level: "L2",
                effects: [
                    { kind: "read", scope: PRIMARY_SCOPE, reversible: true, receipt: true },
                ],
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
                effects: [
                    { kind: "read", scope: PRIMARY_SCOPE, reversible: true, receipt: true },
                ],
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
                effects: [
                    { kind: "grant", scope: "03_approve", reversible: true, receipt: true },
                ],
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
                effects: [
                    { kind: "irreversible", scope: PRIMARY_SCOPE, reversible: false, receipt: true },
                ],
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
                {
                    id: "01_read",
                    title: "读取数据",
                    affordance: "a:read_dataset",
                },
                {
                    id: "02_validate",
                    title: "校验数据",
                    affordance: "a:validate_dataset",
                },
                {
                    id: "03_approve",
                    title: "审批发布",
                    affordance: "a:approve_publish",
                    requires: ["role:approver"],
                },
                {
                    id: "04_publish",
                    title: "发布结果",
                    affordance: "a:publish_result",
                    requires: ["grant:03_approve"],
                },
            ],
        };
    }
}
