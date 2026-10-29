/**
 * AMP parity harness.
 *
 * Runs the same fixtures against two independent implementations:
 * - the published build of `attention-manifest-protocol` 0.4.1 under
 *   `R:\project\attention-manifest-protocol\lib` (ESM JavaScript);
 * - the verbatim TypeScript vendor copy under `electron/protocol/amp`.
 *
 * Every case records `{ case, ok, detail }`. The JSON report is printed on
 * stdout, the human-readable summary on stderr. Any mismatch exits non-zero and
 * embeds the minimal reproducer in the case detail.
 *
 * Run with: node --experimental-strip-types tools/amp-parity.ts
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as vendorSemantics from "../electron/protocol/amp/semantic/index.ts";
import * as vendorBayesEngine from "../electron/protocol/amp/bayes/engine.ts";
import * as vendorBayesCalibration from "../electron/protocol/amp/bayes/calibration.ts";
import * as vendorBayesReliability from "../electron/protocol/amp/bayes/reliability.ts";
import * as vendorAttention from "../electron/protocol/amp/attention/attention.ts";
import * as vendorBudget from "../electron/protocol/amp/attention/budget.ts";
import * as vendorLedger from "../electron/protocol/amp/ledger/index.ts";
import * as vendorLedgerPersistence from "../electron/protocol/amp/ledger/persistence.ts";
import * as vendorLedgerCheckpoint from "../electron/protocol/amp/ledger/checkpoint.ts";
import * as vendorManifestSign from "../electron/protocol/amp/manifest/sign.ts";
import * as vendorHandles from "../electron/protocol/amp/execution/handles.ts";
import * as vendorBoundaryFrame from "../electron/protocol/amp/boundary/frame.ts";
import * as vendorBoundaryToolCall from "../electron/protocol/amp/boundary/toolCall.ts";
import * as vendorBoundaryRefTable from "../electron/protocol/amp/boundary/refTable.ts";
import * as vendorPolicy from "../electron/protocol/amp/policy/index.ts";
import * as vendorWarrant from "../electron/protocol/amp/warrant/index.ts";
import * as vendorEnvelope from "../electron/protocol/amp/protocol/envelope.ts";
import * as vendorWire from "../electron/protocol/amp/protocol/wire.ts";

import type { Budget, Digest, Handle, Ref, Tier } from "../electron/protocol/amp/types/common.ts";
import type { Capability, Manifest } from "../electron/protocol/amp/manifest/manifest.ts";
import type { KeyPair } from "../electron/protocol/amp/manifest/sign.ts";
import type { BetaBelief, Dimension, Evidence } from "../electron/protocol/amp/bayes/engine.ts";
import type { CalibrationPoint } from "../electron/protocol/amp/bayes/calibration.ts";
import type { AttentionItem, AttentionOptions, Candidate, Selection, SelectionOptions } from "../electron/protocol/amp/attention/attention.ts";
import type { Frame } from "../electron/protocol/amp/frame/frame.ts";
import type { Claim, ClaimStatus, EvidenceItem } from "../electron/protocol/amp/warrant/epistemic.ts";
import type { AmpEvent, Receipt } from "../electron/protocol/amp/receipt/receipt.ts";
import type { ChainEntry, LedgerSnapshot } from "../electron/protocol/amp/ledger/persistence.ts";
import type { CheckpointOptions, LedgerCheckpoint } from "../electron/protocol/amp/ledger/checkpoint.ts";
import type { FrameDraft } from "../electron/protocol/amp/boundary/frame.ts";
import type { ToolSchema } from "../electron/protocol/amp/boundary/toolCall.ts";
import type { Approval, EffectClass, PolicyVerdict } from "../electron/protocol/amp/policy/policy.ts";
import type { Delegation, Lease } from "../electron/protocol/amp/delegate/team.ts";
import type { EnvelopeInput, SealedEnvelope } from "../electron/protocol/amp/protocol/envelope.ts";

type SemanticModule = typeof vendorSemantics;
type BayesEngineModule = typeof vendorBayesEngine;
type BayesCalibrationModule = typeof vendorBayesCalibration;
type BayesReliabilityModule = typeof vendorBayesReliability;
type AttentionModule = typeof vendorAttention;
type BudgetModule = typeof vendorBudget;
type LedgerModule = typeof vendorLedger;
type LedgerPersistenceModule = typeof vendorLedgerPersistence;
type LedgerCheckpointModule = typeof vendorLedgerCheckpoint;
type ManifestSignModule = typeof vendorManifestSign;
type HandlesModule = typeof vendorHandles;
type BoundaryFrameModule = typeof vendorBoundaryFrame;
type BoundaryToolCallModule = typeof vendorBoundaryToolCall;
type BoundaryRefTableModule = typeof vendorBoundaryRefTable;
type PolicyModule = typeof vendorPolicy;
type WarrantModule = typeof vendorWarrant;
type EnvelopeModule = typeof vendorEnvelope;
type WireModule = typeof vendorWire;

const ReferenceLibDefault: string = "R:\\project\\attention-manifest-protocol\\lib";
const ReferenceLib: string = process.env.AMP_REF_LIB ?? ReferenceLibDefault;
const VendorRoot: string = "electron/protocol/amp";
const FixtureTimestamp: string = "2026-10-29T00:00:00.000Z";
const LaterTimestamp: string = "2026-10-29T00:05:00.000Z";
const DigestA: Digest = `sha256:${"1".repeat(64)}`;
const DigestB: Digest = `sha256:${"2".repeat(64)}`;
const FixedNonce: string = "00112233445566778899aabbccddeeff";

/**
 * Loads one published-build subpath as a typed namespace.
 *
 * The specification is computed at runtime, so TypeScript does not try to
 * resolve the reference repository's absolute path at compile time.
 */
const loadReference = async <T>(relativePath: string): Promise<T> => {
    const url: string = pathToFileURL(join(ReferenceLib, relativePath)).href;
    return (await import(url)) as T;
};

const refSemantics: SemanticModule = await loadReference<SemanticModule>("semantic/index.js");
const refBayesEngine: BayesEngineModule = await loadReference<BayesEngineModule>("bayes/engine.js");
const refBayesCalibration: BayesCalibrationModule = await loadReference<BayesCalibrationModule>("bayes/calibration.js");
const refBayesReliability: BayesReliabilityModule = await loadReference<BayesReliabilityModule>("bayes/reliability.js");
const refAttention: AttentionModule = await loadReference<AttentionModule>("attention/attention.js");
const refBudget: BudgetModule = await loadReference<BudgetModule>("attention/budget.js");
const refLedger: LedgerModule = await loadReference<LedgerModule>("ledger/index.js");
const refLedgerPersistence: LedgerPersistenceModule = await loadReference<LedgerPersistenceModule>("ledger/persistence.js");
const refLedgerCheckpoint: LedgerCheckpointModule = await loadReference<LedgerCheckpointModule>("ledger/checkpoint.js");
const refManifestSign: ManifestSignModule = await loadReference<ManifestSignModule>("manifest/sign.js");
const refHandles: HandlesModule = await loadReference<HandlesModule>("execution/handles.js");
const refBoundaryFrame: BoundaryFrameModule = await loadReference<BoundaryFrameModule>("boundary/frame.js");
const refBoundaryToolCall: BoundaryToolCallModule = await loadReference<BoundaryToolCallModule>("boundary/toolCall.js");
const refBoundaryRefTable: BoundaryRefTableModule = await loadReference<BoundaryRefTableModule>("boundary/refTable.js");
const refPolicy: PolicyModule = await loadReference<PolicyModule>("policy/index.js");
const refWarrant: WarrantModule = await loadReference<WarrantModule>("warrant/index.js");
const refEnvelope: EnvelopeModule = await loadReference<EnvelopeModule>("protocol/envelope.js");
const refWire: WireModule = await loadReference<WireModule>("protocol/wire.js");

/**
 * Fixed Ed25519 seed (32 bytes). PKCS#8 wraps a raw seed behind a constant
 * prefix, so both the signature and the manifest/checkpoint bytes are stable
 * across runs and across machines.
 */
const FixedSeed: Buffer = Buffer.from("9f2c1a7e4b6d8f0a1c3e5b7d9f1a2c4e6b8d0f1a3c5e7b9d1f2a4c6e8b0d1f3a", "hex");
const Pkcs8Prefix: Buffer = Buffer.from("302e020100300506032b657004220420", "hex");
const FixedPrivateDer: Buffer = Buffer.concat([Pkcs8Prefix, FixedSeed]);
const FixedPrivateObject = createPrivateKey({ key: FixedPrivateDer, format: "der", type: "pkcs8" });
const FixedPublicDer: Buffer = createPublicKey(FixedPrivateObject).export({ format: "der", type: "spki" }) as Buffer;
const FixedPublicRaw: Buffer = FixedPublicDer.subarray(FixedPublicDer.length - 32);
const FixedPrivateKey: CryptoKey = await crypto.subtle.importKey("pkcs8", new Uint8Array(FixedPrivateDer), "Ed25519", false, ["sign"]);
const FixedPublicKey: CryptoKey = await crypto.subtle.importKey("raw", new Uint8Array(FixedPublicRaw), "Ed25519", true, ["verify"]);
const FixedKey: KeyPair = { kid: "agent.calendar", publicKey: FixedPublicKey, privateKey: FixedPrivateKey };

interface CaseResult {
    case: string;
    ok: boolean;
    detail: string;
}

interface VerifyVerdict {
    ok: boolean;
    reasons: string[];
}

interface ErrorShape {
    name: string;
    code: string;
    message: string;
    problems: string[];
    retryAfterMs: number | null;
    limit: number | null;
    observed: number | null;
    dimension: string | null;
}

interface Capture {
    threw: boolean;
    value: unknown;
    error: ErrorShape | null;
}

const results: CaseResult[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof(value) === "object" && value !== null && !Array.isArray(value);
};

const display = (value: unknown): string => {
    if (typeof(value) === "string") {
        return value;
    }
    if (typeof(value) === "number" || typeof(value) === "boolean" || typeof(value) === "bigint") {
        return String(value);
    }
    try {
        const text: string | undefined = JSON.stringify(value);
        return text === (void 0) ? String(value) : text;
    } catch {
        return String(value);
    }
};

const deepEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        for (let index: number = 0; index < left.length; index += 1) {
            if (!deepEqual(left[index], right[index])) {
                return false;
            }
        }
        return true;
    }
    if (isRecord(left) && isRecord(right)) {
        const leftKeys: string[] = Object.keys(left).sort();
        const rightKeys: string[] = Object.keys(right).sort();
        if (!deepEqual(leftKeys, rightKeys)) {
            return false;
        }
        for (let index: number = 0; index < leftKeys.length; index += 1) {
            const key: string = leftKeys[index];
            if (!deepEqual(left[key], right[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
};

const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ case: name, ok, detail });
    console.error(`[${ok ? "ok  " : "FAIL"}] ${name} :: ${detail}`);
};

/**
 * Decodes a base64url signature or key into lowercase hex, so signatures can be
 * compared byte-for-byte instead of as transport strings.
 */
const base64UrlToHex = (text: string): string => {
    const padded: string = text.replace(/-/g, "+").replace(/_/g, "/");
    const padLength: number = padded.length % 4;
    const padding: string = padLength === 0 ? "" : "=".repeat(4 - padLength);
    return Buffer.from(padded + padding, "base64").toString("hex");
};

const compare = (name: string, vendor: unknown, reference: unknown, repro: unknown): void => {
    if (deepEqual(vendor, reference)) {
        record(name, true, "identical");
        return;
    }
    record(name, false, `vendor=${display(vendor)} | lib=${display(reference)} | repro=${display(repro)}`);
};

const errorShape = (error: unknown): ErrorShape => {
    const name: string = error instanceof Error ? error.name : typeof(error);
    const message: string = error instanceof Error ? error.message : String(error);
    const code: string = isRecord(error) && typeof(error.code) === "string" ? error.code : "";
    const rawProblems: unknown = isRecord(error) ? error.problems : (void 0);
    const problems: string[] = Array.isArray(rawProblems) ? rawProblems.filter((item): item is string => typeof(item) === "string") : [];
    const retryAfterMs: number | null = isRecord(error) && typeof(error.retryAfterMs) === "number" ? error.retryAfterMs : null;
    const limit: number | null = isRecord(error) && typeof(error.limit) === "number" ? error.limit : null;
    const observed: number | null = isRecord(error) && typeof(error.observed) === "number" ? error.observed : null;
    const dimension: string | null = isRecord(error) && typeof(error.dimension) === "string" ? error.dimension : null;
    return { name, code, message, problems, retryAfterMs, limit, observed, dimension };
};

const captureSync = (fn: () => unknown): Capture => {
    try {
        return { threw: false, value: fn(), error: null };
    } catch (error: unknown) {
        return { threw: true, value: null, error: errorShape(error) };
    }
};

const captureAsync = async (fn: () => Promise<unknown>): Promise<Capture> => {
    try {
        return { threw: false, value: await fn(), error: null };
    } catch (error: unknown) {
        return { threw: true, value: null, error: errorShape(error) };
    }
};

const cloneSnapshot = (snapshot: LedgerSnapshot): LedgerSnapshot => {
    return JSON.parse(JSON.stringify(snapshot)) as LedgerSnapshot;
};

const makeClaim = (tier: Tier, confidence: number, status: ClaimStatus = "held"): Claim => {
    return {
        amp: "0.1",
        kind: "claim",
        id: `claim.${tier.toLowerCase()}.${String(confidence)}`,
        statement: "fixture claim",
        claim_scope: "definitional",
        tier,
        confidence,
        status,
        warrant: {
            evidence: [],
            inference: "observation",
            strength: confidence,
        },
        provenance: { source: "amp-parity fixture" },
        created: FixtureTimestamp,
    };
};

const makeCandidate = (id: string, overrides: Partial<Candidate>): Candidate => {
    return {
        target: { kind: "concept", id },
        role: "concept",
        voi: 0.6,
        goalFit: 0.8,
        uncertainty: 0.4,
        novelty: 0.2,
        costTokens: 400,
        risk: 0.1,
        trustCap: 1,
        why: `fixture ${id}`,
        ...overrides,
    };
};

async function runCanonical(): Promise<void> {
    const nested: unknown = {
        z: 1,
        a: { d: [3, { b: true, a: null }], c: "值" },
        m: [],
        list: [{ y: 2, x: 1 }, "text", 1.5],
    };
    compare("semantic/canonical/nested-sort", vendorSemantics.canonical(nested), refSemantics.canonical(nested), nested);

    const unicode: unknown = {
        "é": "composed",
        "e\u0301": "decomposed",
        "😀": "emoji",
        "中": "CJK",
        "\u0000": "nul",
        "quote\"slash\\": "line\nfeed\ttab",
        value: "𝄞 surrogate pair",
    };
    compare("semantic/canonical/unicode", vendorSemantics.canonical(unicode), refSemantics.canonical(unicode), unicode);

    const numbers: unknown = {
        zero: 0,
        negativeZero: -0,
        floatSum: 0.1 + 0.2,
        tiny: 1e-7,
        huge: 1e21,
        big: 9007199254740993,
        negative: -1.5,
        exponent: 1.5e300,
    };
    compare("semantic/canonical/numbers", vendorSemantics.canonical(numbers), refSemantics.canonical(numbers), numbers);

    const numericKeys: Record<string, unknown> = { "10": "ten", "2": "two", b: 1, A: 2 };
    compare("semantic/canonical/numeric-keys", vendorSemantics.canonical(numericKeys), refSemantics.canonical(numericKeys), numericKeys);

    const withUndefined: Record<string, unknown> = { a: void 0, b: 1 };
    compare("semantic/canonical/undefined-property", vendorSemantics.canonical(withUndefined), refSemantics.canonical(withUndefined), withUndefined);
    compare("semantic/canonical/undefined-root", vendorSemantics.canonical(void 0), refSemantics.canonical(void 0), "undefined");

    const primitives: unknown[] = [null, true, false, 0, -0, 1e21, 1e-7, "x", ""];
    compare("semantic/canonical/primitives", vendorSemantics.canonical(primitives), refSemantics.canonical(primitives), primitives);

    const vendorDigest: Digest = vendorSemantics.digestOf(nested);
    const referenceDigest: Digest = refSemantics.digestOf(nested);
    const formatOk: boolean = /^sha256:[0-9a-f]{64}$/.test(vendorDigest) && vendorDigest === referenceDigest;
    record("semantic/digest/format", formatOk, `vendor=${vendorDigest} lib=${referenceDigest}`);

    const vendorCanonical: string = vendorSemantics.canonical(nested);
    const reparsed: unknown = JSON.parse(vendorCanonical);
    const idempotent: boolean = vendorSemantics.canonical(reparsed) === vendorCanonical && refSemantics.canonical(reparsed) === vendorCanonical;
    record("semantic/canonical/idempotent", idempotent, `canonical=${vendorCanonical}`);
}

async function runSha256(): Promise<void> {
    const vectors: { name: string; input: string }[] = [
        { name: "empty", input: "" },
        { name: "abc", input: "abc" },
        { name: "sentence", input: "The quick brown fox jumps over the lazy dog" },
        { name: "unicode", input: "你好，🌍 café e\u0301 𝄞" },
        { name: "long", input: "ab".repeat(4096) },
    ];
    for (let index: number = 0; index < vectors.length; index += 1) {
        const vector: { name: string; input: string } = vectors[index];
        const vendor: string = vendorSemantics.sha256Hex(vector.input);
        const reference: string = refSemantics.sha256Hex(vector.input);
        const oracle: string = createHash("sha256").update(vector.input, "utf8").digest("hex");
        const ok: boolean = vendor === reference && vendor === oracle;
        record(`semantic/sha256/${vector.name}`, ok, `vendor=${vendor} lib=${reference} oracle=${oracle}`);
    }
    const input: string = "periodicity-calendar";
    const oracle: string = createHash("sha256").update(input, "utf8").digest("hex");
    const vendorDigest: Digest = `sha256:${vendorSemantics.sha256Hex(input)}`;
    const referenceDigest: Digest = `sha256:${refSemantics.sha256Hex(input)}`;
    record(
        "semantic/sha256/digest-wrapper",
        vendorDigest === referenceDigest && vendorDigest === `sha256:${oracle}` && /^sha256:[0-9a-f]{64}$/.test(vendorDigest),
        `vendor=${vendorDigest} lib=${referenceDigest} oracle=${oracle}`,
    );

    const boundaryLengths: number[] = [0, 1, 2, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 257];
    let boundaryFailure: string = "";
    for (let index: number = 0; index < boundaryLengths.length; index += 1) {
        const length: number = boundaryLengths[index];
        const text: string = "a".repeat(length);
        const vendor: string = vendorSemantics.sha256Hex(text);
        const reference: string = refSemantics.sha256Hex(text);
        const oracle: string = createHash("sha256").update(text, "utf8").digest("hex");
        if (vendor !== reference || vendor !== oracle) {
            boundaryFailure = `length=${String(length)} vendor=${vendor} lib=${reference} oracle=${oracle}`;
            break;
        }
    }
    record(
        "semantic/sha256/padding-boundaries",
        boundaryFailure.length === 0,
        boundaryFailure.length === 0
            ? `lengths=${boundaryLengths
                  .map((value: number): string => {
                      return String(value);
                  })
                  .join(",")}`
            : boundaryFailure,
    );
}

const unsignedManifest: Omit<Manifest, "digest" | "signatures"> = {
    amp: "0.1",
    kind: "manifest",
    agent: { id: "agent.calendar", name: "Periodicity Calendar", version: "0.1.0", role: "publisher" },
    issued: FixtureTimestamp,
    expires: "2026-11-28T00:00:00.000Z",
    identity: {
        values: [{ id: "value.fidelity", statement: "Never silently overwrite an imported source.", weight: 0.9 }],
        constraints: [{ id: "constraint.local-only", statement: "No network egress.", enforcement: "hard" }],
    },
    capabilities: [
        {
            id: "cap.import",
            label: "Import a calendar source",
            kind: "tool",
            confidence: 0.82,
            tier: "T3",
            cost: { tokens: 1200, calls: 1, ms: 4000 },
            limits: ["local files only"],
            evidence: [{ kind: "receipt", id: "rcpt.import.1" }],
        },
        {
            id: "cap.verify",
            label: "Verify a source schema",
            kind: "skill",
            confidence: 0.74,
            tier: "T2",
            cost: { tokens: 300 },
        },
    ],
    concepts: [{ kind: "concept", id: "concept.lunar-table" }],
    commitments: [
        {
            id: "commit.owner-review",
            to: { kind: "human", id: "human.owner" },
            promise: "Ask before publishing.",
            due: "2026-11-01T00:00:00.000Z",
            status: "open",
            created: FixtureTimestamp,
        },
    ],
    unknowns: [
        {
            id: "unknown.leap-seconds",
            question: "Does the source include leap seconds?",
            importance: 0.7,
            blocking: false,
            since: FixtureTimestamp,
        },
    ],
    attention: {
        policy_digest: DigestA,
        frame: { kind: "frame", id: "frame.initial" },
        budget: { tokens: 8000, calls: 20, ms: 60000, interrupts: 2, money: 0.25 },
    },
    self: {
        calibration: {
            ece: 0.08,
            buckets: [
                { lo: 0, hi: 0.5, predicted: 0.25, observed: 0.2, n: 12 },
                { lo: 0.5, hi: 1, predicted: 0.75, observed: 0.8, n: 9 },
            ],
        },
        limits: ["no network"],
        state: { load: 0.4, mode: "explore" },
    },
};

async function runManifest(): Promise<void> {
    const vendorDigest: Digest = vendorManifestSign.contentDigest(unsignedManifest);
    const referenceDigest: Digest = refManifestSign.contentDigest(unsignedManifest);
    compare("manifest/content-digest", vendorDigest, referenceDigest, unsignedManifest);

    const vendorSigned: Manifest = await vendorManifestSign.signManifest(unsignedManifest, FixedKey);
    const referenceSigned: Manifest = await refManifestSign.signManifest(unsignedManifest, FixedKey);
    compare("manifest/sign-fixed-key", vendorSigned, referenceSigned, unsignedManifest);
    record(
        "manifest/signature-bytes",
        vendorSigned.signatures[0].sig === referenceSigned.signatures[0].sig,
        `vendor=${vendorSigned.signatures[0].sig} lib=${referenceSigned.signatures[0].sig}`,
    );

    const vendorVerdict: VerifyVerdict = await vendorManifestSign.verifyManifest(vendorSigned, FixedPublicKey);
    const referenceVerdict: VerifyVerdict = await refManifestSign.verifyManifest(referenceSigned, FixedPublicKey);
    compare("manifest/verify-ok", vendorVerdict, referenceVerdict, vendorSigned);

    const tamperedBody: Manifest = {
        ...vendorSigned,
        identity: {
            values: [{ id: "value.fidelity", statement: "tampered statement", weight: 0.9 }],
        },
    };
    const vendorTamperedBody: VerifyVerdict = await vendorManifestSign.verifyManifest(tamperedBody, FixedPublicKey);
    const referenceTamperedBody: VerifyVerdict = await refManifestSign.verifyManifest(tamperedBody, FixedPublicKey);
    compare("manifest/verify-tampered-body", vendorTamperedBody, referenceTamperedBody, { identity: tamperedBody.identity });

    const tamperedDigest: Manifest = { ...vendorSigned, digest: DigestB };
    const vendorTamperedDigest: VerifyVerdict = await vendorManifestSign.verifyManifest(tamperedDigest, FixedPublicKey);
    const referenceTamperedDigest: VerifyVerdict = await refManifestSign.verifyManifest(tamperedDigest, FixedPublicKey);
    compare("manifest/verify-tampered-digest", vendorTamperedDigest, referenceTamperedDigest, { digest: DigestB });

    const missingSignature: Manifest = { ...vendorSigned, signatures: [] };
    const vendorMissing: VerifyVerdict = await vendorManifestSign.verifyManifest(missingSignature, FixedPublicKey);
    const referenceMissing: VerifyVerdict = await refManifestSign.verifyManifest(missingSignature, FixedPublicKey);
    compare("manifest/verify-missing-signature", vendorMissing, referenceMissing, { signatures: [] });

    const vendorRegistry: InstanceType<ManifestSignModule["KeyRegistry"]> = new vendorManifestSign.KeyRegistry();
    const referenceRegistry: InstanceType<ManifestSignModule["KeyRegistry"]> = new refManifestSign.KeyRegistry();
    vendorRegistry.add(FixedKey.kid, FixedPublicKey);
    referenceRegistry.add(FixedKey.kid, FixedPublicKey);
    const vendorRegistered: VerifyVerdict = await vendorManifestSign.verifyWithRegistry(vendorSigned, vendorRegistry);
    const referenceRegistered: VerifyVerdict = await refManifestSign.verifyWithRegistry(referenceSigned, referenceRegistry);
    compare("manifest/registry-ok", vendorRegistered, referenceRegistered, vendorSigned);

    vendorRegistry.revoke(FixedKey.kid);
    referenceRegistry.revoke(FixedKey.kid);
    const vendorRevoked: VerifyVerdict = await vendorManifestSign.verifyWithRegistry(vendorSigned, vendorRegistry);
    const referenceRevoked: VerifyVerdict = await refManifestSign.verifyWithRegistry(referenceSigned, referenceRegistry);
    compare("manifest/registry-revoked", vendorRevoked, referenceRevoked, { kid: FixedKey.kid });

    const capabilityCopy: Capability[] = vendorSigned.capabilities.map((capability) => {
        return { ...capability, label: `${capability.label ?? ""} tampered` };
    });
    const tamperedCapability: Manifest = { ...vendorSigned, capabilities: capabilityCopy };
    const vendorTamperedCapability: VerifyVerdict = await vendorManifestSign.verifyManifest(tamperedCapability, FixedPublicKey);
    const referenceTamperedCapability: VerifyVerdict = await refManifestSign.verifyManifest(tamperedCapability, FixedPublicKey);
    compare("manifest/verify-tampered-capability", vendorTamperedCapability, referenceTamperedCapability, capabilityCopy);

    const generatedKid: string = "kid.parity.ed25519";
    const vendorGenerated: KeyPair = await vendorManifestSign.generateSigningKey(generatedKid);
    const referenceGenerated: KeyPair = await refManifestSign.generateSigningKey(generatedKid);
    const keyShape = async (pair: KeyPair): Promise<Record<string, unknown>> => {
        const rawPublic: Uint8Array = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
        const rawPrivate: Uint8Array = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
        return {
            kid: pair.kid,
            publicType: pair.publicKey.type,
            privateType: pair.privateKey.type,
            publicAlgorithm: pair.publicKey.algorithm.name,
            privateAlgorithm: pair.privateKey.algorithm.name,
            publicRawBytes: rawPublic.length,
            privatePkcs8Bytes: rawPrivate.length,
        };
    };
    compare("manifest/generate-key-shape", await keyShape(vendorGenerated), await keyShape(referenceGenerated), { kid: generatedKid });

    const vendorGeneratedSign: Manifest = await vendorManifestSign.signManifest(unsignedManifest, referenceGenerated);
    const referenceGeneratedSign: Manifest = await refManifestSign.signManifest(unsignedManifest, referenceGenerated);
    compare("manifest/generate-key-signature", vendorGeneratedSign, referenceGeneratedSign, { kid: generatedKid });
    const vendorGeneratedSigHex: string = base64UrlToHex(vendorGeneratedSign.signatures[0].sig);
    const referenceGeneratedSigHex: string = base64UrlToHex(referenceGeneratedSign.signatures[0].sig);
    record(
        "manifest/generate-key-signature-bytes",
        vendorGeneratedSigHex === referenceGeneratedSigHex && vendorGeneratedSigHex.length === 128,
        vendorGeneratedSigHex === referenceGeneratedSigHex && vendorGeneratedSigHex.length === 128
            ? `kid=${generatedKid} vendor=${vendorGeneratedSigHex} lib=${referenceGeneratedSigHex}`
            : `kid=${generatedKid} vendor=${vendorGeneratedSigHex} lib=${referenceGeneratedSigHex} repro=${display(unsignedManifest)}`,
    );

    const vendorVerdictOnGenerated: VerifyVerdict = await vendorManifestSign.verifyManifest(referenceGeneratedSign, referenceGenerated.publicKey);
    const referenceVerdictOnGenerated: VerifyVerdict = await refManifestSign.verifyManifest(vendorGeneratedSign, referenceGenerated.publicKey);
    record(
        "manifest/generate-key-cross-verify",
        deepEqual(vendorVerdictOnGenerated, referenceVerdictOnGenerated) && vendorVerdictOnGenerated.ok && referenceVerdictOnGenerated.ok,
        `kid=${generatedKid} vendor=${display(vendorVerdictOnGenerated)} lib=${display(referenceVerdictOnGenerated)}`,
    );

    const vendorKeySign: Manifest = await vendorManifestSign.signManifest(unsignedManifest, vendorGenerated);
    const vendorVerdictOnVendorKey: VerifyVerdict = await vendorManifestSign.verifyManifest(vendorKeySign, vendorGenerated.publicKey);
    const referenceVerdictOnVendorKey: VerifyVerdict = await refManifestSign.verifyManifest(vendorKeySign, vendorGenerated.publicKey);
    record(
        "manifest/generate-key-vendor-key-verify",
        deepEqual(vendorVerdictOnVendorKey, referenceVerdictOnVendorKey) && referenceVerdictOnVendorKey.ok,
        `kid=${generatedKid} vendor=${display(vendorVerdictOnVendorKey)} lib=${display(referenceVerdictOnVendorKey)}`,
    );
}

async function runBayes(): Promise<void> {
    compare("bayes/default-priors", vendorBayesEngine.DefaultPriors, refBayesEngine.DefaultPriors, "DefaultPriors");

    const beliefs: BetaBelief[] = [
        { alpha: 2, beta: 2 },
        { alpha: 17.5, beta: 3.25 },
        { alpha: 0.5, beta: 12 },
    ];
    const vendorMeans: number[] = beliefs.map((belief) => {
        return vendorBayesEngine.betaMean(belief);
    });
    const referenceMeans: number[] = beliefs.map((belief) => {
        return refBayesEngine.betaMean(belief);
    });
    compare("bayes/beta-mean", vendorMeans, referenceMeans, beliefs);
    const vendorVariances: number[] = beliefs.map((belief) => {
        return vendorBayesEngine.betaVariance(belief);
    });
    const referenceVariances: number[] = beliefs.map((belief) => {
        return refBayesEngine.betaVariance(belief);
    });
    compare("bayes/beta-variance", vendorVariances, referenceVariances, beliefs);

    const evidence: Evidence[] = [
        { dimension: "clarity", positive: 0.7, negative: 0.2, reliability: 0.8, source: "text" },
        { dimension: "clarity", positive: 0.3, negative: 0.1, reliability: 1, source: "external" },
        { dimension: "clarity", positive: 0.5, negative: 0, reliability: 1.2, source: "unweighted" },
        { dimension: "specificity", positive: 0.9, negative: 0, reliability: 1, source: "text" },
    ];
    const sourceWeights: Record<string, number> = { text: 0.75, external: 0.25, unweighted: 1 };
    compare(
        "bayes/posterior-of-source-weights",
        vendorBayesEngine.posteriorOf({ alpha: 2, beta: 3 }, evidence, "clarity", sourceWeights),
        refBayesEngine.posteriorOf({ alpha: 2, beta: 3 }, evidence, "clarity", sourceWeights),
        { prior: { alpha: 2, beta: 3 }, evidence, sourceWeights },
    );

    const priorOverrides: Partial<Record<Dimension, BetaBelief>> = {
        clarity: { alpha: 3, beta: 1 },
        safety: { alpha: 5, beta: 1 },
    };
    const engineWeights: Record<string, number> = { text: 0.75, checker: 1, telemetry: 0.5 };
    const vendorEngine = new vendorBayesEngine.BayesianEngine(priorOverrides, engineWeights);
    const referenceEngine = new refBayesEngine.BayesianEngine(priorOverrides, engineWeights);

    const userText: string = "Please verify the lunar table within 2 days - I am anxious, but open to alternatives. Is 1,247 rows correct?";
    const vendorUser = vendorEngine.scoreUser(userText, { reliability: 0.8 });
    const referenceUser = referenceEngine.scoreUser(userText, { reliability: 0.8 });
    compare("bayes/score-user", vendorUser, referenceUser, { text: userText, reliability: 0.8 });

    const answerText: string =
        "1. Run the schema check on 1,247 rows.\n2. Compare source:lunar.csv with the manifest digest.\n" +
        "The result is probably correct, but check the leap-second column before publishing.";
    const answerMeta = { correct: true, grounded: true, safe: true, uncertain: true, targetTokens: 80, helpful: true };
    const vendorAnswer = vendorEngine.scoreAnswer(answerText, answerMeta);
    const referenceAnswer = referenceEngine.scoreAnswer(answerText, answerMeta);
    compare("bayes/score-answer", vendorAnswer, referenceAnswer, { text: answerText, meta: answerMeta });

    const attentionMetrics = {
        utilization: 0.82,
        pressure: 0.61,
        recoveryDebt: 0.4,
        errors: 2,
        switches: 7,
        latencyMs: 2600,
        targetLatencyMs: 2000,
        vigilance: 0.55,
        stress: 0.6,
        fatigue: 0.45,
    };
    const vendorAttentionScore = vendorEngine.scoreAttention(attentionMetrics);
    const referenceAttentionScore = referenceEngine.scoreAttention(attentionMetrics);
    compare("bayes/score-attention", vendorAttentionScore, referenceAttentionScore, attentionMetrics);

    const interactionWeights: Record<string, number> = {
        affect: 0.3,
        think: 0.25,
        inspire: 0.15,
        converge: 0.2,
        orchestrate: 0.1,
    };
    compare(
        "bayes/interaction-fit",
        vendorEngine.interactionFit(vendorUser, { weights: interactionWeights as never }),
        referenceEngine.interactionFit(referenceUser, { weights: interactionWeights as never }),
        { weights: interactionWeights },
    );

    const vendorFeatures = vendorBayesEngine.extractUserFeatures(userText);
    const referenceFeatures = refBayesEngine.extractUserFeatures(userText);
    compare("bayes/user-features", vendorFeatures, referenceFeatures, userText);
    const vendorAnswerFeatures = vendorBayesEngine.extractAnswerFeatures(answerText);
    const referenceAnswerFeatures = refBayesEngine.extractAnswerFeatures(answerText);
    compare("bayes/answer-features", vendorAnswerFeatures, referenceAnswerFeatures, answerText);

    vendorEngine.learn(evidence);
    referenceEngine.learn(evidence);
    compare("bayes/learn-snapshot", vendorEngine.snapshot(), referenceEngine.snapshot(), evidence);

    const vendorWeightsEngine = new vendorBayesEngine.BayesianEngine();
    const referenceWeightsEngine = new refBayesEngine.BayesianEngine();
    vendorWeightsEngine.setSourceWeights({ text: 0.4, external: 1.5 });
    referenceWeightsEngine.setSourceWeights({ text: 0.4, external: 1.5 });
    compare("bayes/set-source-weights", vendorWeightsEngine.sourceWeightsSnapshot(), referenceWeightsEngine.sourceWeightsSnapshot(), {
        text: 0.4,
        external: 1.5,
    });
}

/**
 * Warrant-layer parity. The reference has no log-odds primitive: "belief" is the
 * Beta posterior from bayes/engine, and the dependence discount is the
 * multiplicative `clamp01(reliability) * clamp01(sourceWeight)` factor applied
 * before evidence counts are added. Derived warrant confidence is compared
 * separately. Both sides are exact (`Object.is` for every number); the reference
 * defines no epsilon, so none is applied here.
 */
async function runWarrant(): Promise<void> {
    const primaryEvidence: EvidenceItem[] = [
        {
            id: "ev.primary.1",
            kind: "observation",
            trust: "verified",
            independence: 1,
            relation: "supports",
            entails: true,
            origin: "origin.sensor",
            at: FixtureTimestamp,
        },
        {
            id: "ev.primary.2",
            kind: "test",
            trust: "trusted",
            independence: 0.6,
            relation: "supports",
            origin: "origin.report",
            at: FixtureTimestamp,
        },
        {
            id: "ev.primary.3",
            kind: "testimony",
            trust: "asserted",
            independence: 0.3,
            relation: "undercuts",
            origin: "origin.sensor",
            at: FixtureTimestamp,
        },
    ];
    const secondaryEvidence: EvidenceItem[] = [
        {
            id: "ev.secondary.1",
            kind: "document",
            trust: "verified",
            independence: 0.8,
            relation: "supports",
            origin: "origin.archive",
            at: FixtureTimestamp,
        },
    ];
    const contradictionEvidence: EvidenceItem[] = [
        {
            id: "ev.contradiction.1",
            kind: "observation",
            trust: "verified",
            independence: 0.9,
            relation: "contradicts",
            origin: "origin.counter",
            at: FixtureTimestamp,
        },
    ];

    const claimOf = (id: string, tier: Tier, status: ClaimStatus, items: EvidenceItem[], confidence?: number): Claim => {
        const base: Claim = {
            amp: "0.1",
            kind: "claim",
            id,
            statement: "warrant parity fixture",
            claim_scope: "definitional",
            tier,
            status,
            warrant: { evidence: items, inference: "testimony", strength: 0.7 },
            provenance: { source: "amp-parity fixture" },
            created: FixtureTimestamp,
        };
        if (confidence === (void 0)) {
            return base;
        }
        return { ...base, confidence };
    };

    interface PosteriorFixture {
        name: string;
        prior: BetaBelief;
        dimension: Dimension;
        items: Evidence[];
        weights: Record<string, number>;
    }

    const posteriorFixtures: PosteriorFixture[] = [
        {
            name: "reliability-and-source-weight",
            prior: { alpha: 2, beta: 2 },
            dimension: "correctness",
            items: [
                { dimension: "correctness", positive: 2.5, negative: 0.5, reliability: 0.8, source: "checker" },
                { dimension: "correctness", positive: 1, negative: 2, reliability: 0.4, source: "heuristic" },
                { dimension: "clarity", positive: 5, negative: 0, reliability: 1, source: "text" },
            ],
            weights: { checker: 0.5, heuristic: 0.25, text: 1 },
        },
        {
            name: "clamped-inputs",
            prior: { alpha: 0.5, beta: 0.25 },
            dimension: "load",
            items: [
                { dimension: "load", positive: 3, negative: 1, reliability: 1.7, source: "telemetry" },
                { dimension: "load", positive: 2, negative: 4, reliability: -0.5, source: "telemetry" },
            ],
            weights: { telemetry: 2 },
        },
        {
            name: "no-matching-evidence",
            prior: { alpha: 4, beta: 6 },
            dimension: "fatigue",
            items: [{ dimension: "stress", positive: 1, negative: 1, reliability: 1, source: "telemetry" }],
            weights: { telemetry: 0.5 },
        },
    ];

    for (let index: number = 0; index < posteriorFixtures.length; index += 1) {
        const fixture: PosteriorFixture = posteriorFixtures[index];
        const vendorPosterior = vendorBayesEngine.posteriorOf(fixture.prior, fixture.items, fixture.dimension, fixture.weights);
        const referencePosterior = refBayesEngine.posteriorOf(fixture.prior, fixture.items, fixture.dimension, fixture.weights);
        const ok: boolean = deepEqual(vendorPosterior, referencePosterior);
        record(
            `warrant/epistemic/posterior-${fixture.name}`,
            ok,
            ok
                ? `alpha=${String(vendorPosterior.alpha)} beta=${String(vendorPosterior.beta)} mean=${String(vendorPosterior.mean)} evidence=${String(vendorPosterior.evidenceCount)}`
                : `vendor=${display(vendorPosterior)} lib=${display(referencePosterior)} repro=${display(fixture)}`,
        );
    }

    const clamp01 = (value: number): number => {
        return Math.max(0, Math.min(1, value));
    };
    const discountedContribution = (positive: number, reliability: number, weight: number): number => {
        return positive * (clamp01(reliability) * clamp01(weight));
    };
    const discountPrior: BetaBelief = { alpha: 1, beta: 1 };
    const discountItems: Evidence[] = [
        { dimension: "correctness", positive: 3, negative: 1, reliability: 0.8, source: "checker" },
        { dimension: "correctness", positive: 2, negative: 0.5, reliability: 0.4, source: "heuristic" },
    ];
    const discountWeights: Record<string, number> = { checker: 0.5, heuristic: 0.25 };
    const expectedAlpha: number =
        discountPrior.alpha + discountedContribution(3, 0.8, 0.5) + discountedContribution(2, 0.4, 0.25);
    const expectedBeta: number =
        discountPrior.beta + discountedContribution(1, 0.8, 0.5) + discountedContribution(0.5, 0.4, 0.25);
    const vendorDiscounted = vendorBayesEngine.posteriorOf(discountPrior, discountItems, "correctness", discountWeights);
    const referenceDiscounted = refBayesEngine.posteriorOf(discountPrior, discountItems, "correctness", discountWeights);
    const discountOk: boolean =
        deepEqual(vendorDiscounted, referenceDiscounted) && Object.is(vendorDiscounted.alpha, expectedAlpha) && Object.is(vendorDiscounted.beta, expectedBeta);
    record(
        "warrant/epistemic/dependency-discount",
        discountOk,
        discountOk
            ? `alpha=${String(vendorDiscounted.alpha)} expected=${String(expectedAlpha)} beta=${String(vendorDiscounted.beta)} expected=${String(expectedBeta)}`
            : `vendor=${display(vendorDiscounted)} lib=${display(referenceDiscounted)} expectedAlpha=${String(expectedAlpha)} expectedBeta=${String(expectedBeta)} repro=${display({
                  prior: discountPrior,
                  items: discountItems,
                  weights: discountWeights,
              })}`,
    );

    const confidenceClaims: Claim[] = [
        claimOf("claim.t0.empty", "T0", "held", []),
        claimOf("claim.t2.primary", "T2", "held", primaryEvidence),
        claimOf("claim.t4.all", "T4", "held", [...primaryEvidence, ...secondaryEvidence]),
        claimOf("claim.t3.contradicted", "T3", "held", [...primaryEvidence, ...contradictionEvidence]),
    ];
    const vendorConfidence: number[] = confidenceClaims.map((claim: Claim): number => {
        return vendorWarrant.deriveConfidence(claim);
    });
    const referenceConfidence: number[] = confidenceClaims.map((claim: Claim): number => {
        return refWarrant.deriveConfidence(claim);
    });
    const confidenceOk: boolean = deepEqual(vendorConfidence, referenceConfidence);
    record(
        "warrant/epistemic/derive-confidence",
        confidenceOk,
        confidenceOk
            ? `vendor=${display(vendorConfidence)} lib=${display(referenceConfidence)}`
            : `vendor=${display(vendorConfidence)} lib=${display(referenceConfidence)} repro=${display(confidenceClaims)}`,
    );

    const vendorOrigins: number[] = [primaryEvidence, secondaryEvidence, [...primaryEvidence, ...secondaryEvidence]].map(
        (items: EvidenceItem[]): number => {
            return vendorWarrant.effectiveOrigins(items);
        },
    );
    const referenceOrigins: number[] = [primaryEvidence, secondaryEvidence, [...primaryEvidence, ...secondaryEvidence]].map(
        (items: EvidenceItem[]): number => {
            return refWarrant.effectiveOrigins(items);
        },
    );
    const originsOk: boolean = deepEqual(vendorOrigins, referenceOrigins);
    record(
        "warrant/epistemic/effective-origins",
        originsOk,
        originsOk
            ? `vendor=${display(vendorOrigins)} lib=${display(referenceOrigins)}`
            : `vendor=${display(vendorOrigins)} lib=${display(referenceOrigins)} repro=${display(
                  [primaryEvidence, secondaryEvidence, [...primaryEvidence, ...secondaryEvidence]].map((items: EvidenceItem[]): string[] => {
                      return items.map((item: EvidenceItem): string => {
                          return item.origin ?? item.id;
                      });
                  }),
              )}`,
    );

    const t3WithCausal: Claim = {
        ...claimOf("claim.t3.causal", "T3", "held", primaryEvidence),
        causal: { assignment_mechanism: "randomized", identification_strategy: "coin flip" },
    };
    const interventionalObserved: Claim = {
        ...claimOf("claim.interventional", "T3", "held", primaryEvidence),
        claim_scope: "interventional",
        causal: { assignment_mechanism: "observed" },
    };
    const singleOriginT4: Claim = claimOf("claim.t4.single-origin", "T4", "held", [
        primaryEvidence[0],
        { ...primaryEvidence[1], origin: "origin.sensor" },
    ]);
    const validationClaims: Claim[] = [
        claimOf("claim.t0.valid", "T0", "held", []),
        claimOf("claim.t1.no-entailment", "T1", "held", [primaryEvidence[1]]),
        claimOf("claim.t2.external", "T2", "held", [{ ...primaryEvidence[1], trust: "external" }]),
        { ...claimOf("claim.t3.no-causal", "T3", "held", primaryEvidence) },
        singleOriginT4,
        interventionalObserved,
        t3WithCausal,
    ];
    const vendorProblems: string[][] = validationClaims.map((claim: Claim): string[] => {
        return vendorWarrant.validateClaim(claim);
    });
    const referenceProblems: string[][] = validationClaims.map((claim: Claim): string[] => {
        return refWarrant.validateClaim(claim);
    });
    record(
        "warrant/epistemic/validate-claim",
        deepEqual(vendorProblems, referenceProblems),
        `vendor=${display(vendorProblems)} lib=${display(referenceProblems)}`,
    );

    const lowConfidence: Claim = { ...t3WithCausal, confidence: 0.5 };
    const doubted: Claim = { ...t3WithCausal, status: "doubted" };
    const belowTier: Claim = claimOf("claim.t1.below", "T1", "held", primaryEvidence, 0.9);
    const authorizationClaims: Claim[] = [t3WithCausal, lowConfidence, doubted, belowTier];
    const vendorAuthorizations: boolean[] = authorizationClaims.map((claim: Claim): boolean => {
        return vendorWarrant.canAuthorizeEffect(claim, "T3");
    });
    const referenceAuthorizations: boolean[] = authorizationClaims.map((claim: Claim): boolean => {
        return refWarrant.canAuthorizeEffect(claim, "T3");
    });
    const authorizeOk: boolean = deepEqual(vendorAuthorizations, referenceAuthorizations);
    record(
        "warrant/epistemic/authorize",
        authorizeOk,
        authorizeOk
            ? `vendor=${display(vendorAuthorizations)} lib=${display(referenceAuthorizations)}`
            : `vendor=${display(vendorAuthorizations)} lib=${display(referenceAuthorizations)} repro=${display(
                  authorizationClaims.map((claim: Claim): Record<string, unknown> => {
                      return { id: claim.id, tier: claim.tier, status: claim.status, confidence: claim.confidence ?? "(derived)" };
                  }),
              )}`,
    );

    const evidenceSets: EvidenceItem[][] = [[], primaryEvidence, [primaryEvidence[0]], [...primaryEvidence, ...secondaryEvidence]];
    const vendorSuggestions: Tier[] = evidenceSets.map((items: EvidenceItem[]): Tier => {
        return vendorWarrant.suggestTier(items);
    });
    const referenceSuggestions: Tier[] = evidenceSets.map((items: EvidenceItem[]): Tier => {
        return refWarrant.suggestTier(items);
    });
    const revisedByVendor: Claim = vendorWarrant.reviseClaim(t3WithCausal, { statement: "revised statement" }, "new evidence", LaterTimestamp);
    const revisedByReference: Claim = refWarrant.reviseClaim(t3WithCausal, { statement: "revised statement" }, "new evidence", LaterTimestamp);
    const helperObservation = {
        suggestionsVendor: vendorSuggestions,
        suggestionsReference: referenceSuggestions,
        pressureBlocked: [
            vendorWarrant.pressureBlocked(t3WithCausal, [], true),
            refWarrant.pressureBlocked(t3WithCausal, [], true),
            vendorWarrant.pressureBlocked(t3WithCausal, primaryEvidence, true),
            refWarrant.pressureBlocked(t3WithCausal, primaryEvidence, true),
            vendorWarrant.pressureBlocked((void 0), [], true),
            refWarrant.pressureBlocked((void 0), [], true),
        ],
        revisedVendor: revisedByVendor,
        revisedReference: revisedByReference,
        revisionIds: [revisedByVendor.id, revisedByReference.id],
        previousIds: [revisedByVendor.supersedes?.id ?? "", revisedByReference.supersedes?.id ?? ""],
    };
    const helpersOk: boolean =
        deepEqual(vendorSuggestions, referenceSuggestions) &&
        helperObservation.pressureBlocked[0] === helperObservation.pressureBlocked[1] &&
        helperObservation.pressureBlocked[2] === helperObservation.pressureBlocked[3] &&
        helperObservation.pressureBlocked[4] === helperObservation.pressureBlocked[5] &&
        revisedByVendor.id === revisedByReference.id &&
        revisedByVendor.supersedes?.id === revisedByReference.supersedes?.id &&
        deepEqual(revisedByVendor, revisedByReference);
    record(
        "warrant/epistemic/helpers",
        helpersOk,
        helpersOk
            ? `suggest=${display(vendorSuggestions)} revised=${revisedByVendor.id} supersedes=${revisedByVendor.supersedes?.id ?? ""}`
            : `suggestVendor=${display(vendorSuggestions)} suggestLib=${display(referenceSuggestions)} pressure=${display(
                  helperObservation.pressureBlocked,
              )} revisedVendor=${display(revisedByVendor)} revisedLib=${display(revisedByReference)} repro=${display({
                  evidenceSets: evidenceSets.map((items: EvidenceItem[]): string[] => {
                      return items.map((item: EvidenceItem): string => {
                          return item.id;
                      });
                  }),
                  claim: t3WithCausal.id,
              })}`,
    );
}

const calibrationPoints: CalibrationPoint[] = [
    { predicted: 0.9, actual: true },
    { predicted: 0.8, actual: true },
    { predicted: 0.3, actual: false },
    { predicted: 0.1, actual: false },
    { predicted: 0.5, actual: true },
    { predicted: 0.65, actual: false },
    { predicted: 0.55, actual: true },
    { predicted: 0.2, actual: false },
];

async function runCalibrationAndReliability(): Promise<void> {
    const vendorBrier: number = vendorBayesCalibration.brier(calibrationPoints);
    const referenceBrier: number = refBayesCalibration.brier(calibrationPoints);
    record("bayes/calibration/brier", Object.is(vendorBrier, referenceBrier), `vendor=${String(vendorBrier)} lib=${String(referenceBrier)}`);

    const vendorEce: number = vendorBayesCalibration.ece(calibrationPoints);
    const referenceEce: number = refBayesCalibration.ece(calibrationPoints);
    record("bayes/calibration/ece-default", Object.is(vendorEce, referenceEce), `vendor=${String(vendorEce)} lib=${String(referenceEce)}`);

    const vendorEce5: number = vendorBayesCalibration.ece(calibrationPoints, 5);
    const referenceEce5: number = refBayesCalibration.ece(calibrationPoints, 5);
    record("bayes/calibration/ece-5-bins", Object.is(vendorEce5, referenceEce5), `vendor=${String(vendorEce5)} lib=${String(referenceEce5)}`);

    const vendorIsotonic = vendorBayesCalibration.fitIsotonic(calibrationPoints);
    const referenceIsotonic = refBayesCalibration.fitIsotonic(calibrationPoints);
    compare("bayes/calibration/fit-isotonic", vendorIsotonic, referenceIsotonic, calibrationPoints);

    const probeValues: number[] = [-1, 0, 0.2, 0.5, 0.75, 0.9, 1, 1.5];
    const vendorIsotonicValues: number[] = probeValues.map((value) => {
        return vendorBayesCalibration.applyIsotonic(vendorIsotonic, value);
    });
    const referenceIsotonicValues: number[] = probeValues.map((value) => {
        return refBayesCalibration.applyIsotonic(referenceIsotonic, value);
    });
    compare("bayes/calibration/apply-isotonic", vendorIsotonicValues, referenceIsotonicValues, probeValues);

    const vendorTemperature = vendorBayesCalibration.fitTemperature(calibrationPoints);
    const referenceTemperature = refBayesCalibration.fitTemperature(calibrationPoints);
    compare("bayes/calibration/fit-temperature", vendorTemperature, referenceTemperature, calibrationPoints);

    const customGrid: number[] = [0.5, 1, 2, 4];
    const vendorCustomTemperature = vendorBayesCalibration.fitTemperature(calibrationPoints, customGrid);
    const referenceCustomTemperature = refBayesCalibration.fitTemperature(calibrationPoints, customGrid);
    compare("bayes/calibration/fit-temperature-grid", vendorCustomTemperature, referenceCustomTemperature, customGrid);

    const probePredictions: number[] = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
    const vendorCalibrated: number[] = probePredictions.map((value) => {
        return vendorBayesCalibration.applyTemperature(vendorTemperature, value);
    });
    const referenceCalibrated: number[] = probePredictions.map((value) => {
        return refBayesCalibration.applyTemperature(referenceTemperature, value);
    });
    compare("bayes/calibration/apply-temperature", vendorCalibrated, referenceCalibrated, probePredictions);

    const vendorCross = vendorBayesCalibration.crossValidateCalibration(calibrationPoints, 3);
    const referenceCross = refBayesCalibration.crossValidateCalibration(calibrationPoints, 3);
    compare("bayes/calibration/cross-validate", vendorCross, referenceCross, { points: calibrationPoints, folds: 3 });

    const emptyPoints: CalibrationPoint[] = [];
    const vendorEmpty = {
        brier: vendorBayesCalibration.brier(emptyPoints),
        ece: vendorBayesCalibration.ece(emptyPoints),
        isotonic: vendorBayesCalibration.fitIsotonic(emptyPoints),
        applied: vendorBayesCalibration.applyIsotonic({ thresholds: [], values: [] }, 0.42),
        temperature: vendorBayesCalibration.fitTemperature(emptyPoints),
        cross: vendorBayesCalibration.crossValidateCalibration(emptyPoints, 3),
    };
    const referenceEmpty = {
        brier: refBayesCalibration.brier(emptyPoints),
        ece: refBayesCalibration.ece(emptyPoints),
        isotonic: refBayesCalibration.fitIsotonic(emptyPoints),
        applied: refBayesCalibration.applyIsotonic({ thresholds: [], values: [] }, 0.42),
        temperature: refBayesCalibration.fitTemperature(emptyPoints),
        cross: refBayesCalibration.crossValidateCalibration(emptyPoints, 3),
    };
    compare("bayes/calibration/empty-inputs", vendorEmpty, referenceEmpty, emptyPoints);

    const vendorReliability = new vendorBayesReliability.SourceReliability({ alpha: 3, beta: 1 });
    const referenceReliability = new refBayesReliability.SourceReliability({ alpha: 3, beta: 1 });
    vendorReliability.observe("checker", true, 1);
    referenceReliability.observe("checker", true, 1);
    vendorReliability.observe("checker", false, 2);
    referenceReliability.observe("checker", false, 2);
    vendorReliability.observe("text", true, 0.5);
    referenceReliability.observe("text", true, 0.5);
    const reliabilitySnapshot = {
        checker: vendorReliability.snapshot().checker,
        text: vendorReliability.snapshot().text,
        checkerWeight: vendorReliability.weight("checker"),
        textWeight: vendorReliability.weight("text"),
        unseenWeight: vendorReliability.weight("unseen"),
        weights: vendorReliability.weights(),
        snapshot: vendorReliability.snapshot(),
    };
    const referenceReliabilitySnapshot = {
        checker: referenceReliability.snapshot().checker,
        text: referenceReliability.snapshot().text,
        checkerWeight: referenceReliability.weight("checker"),
        textWeight: referenceReliability.weight("text"),
        unseenWeight: referenceReliability.weight("unseen"),
        weights: referenceReliability.weights(),
        snapshot: referenceReliability.snapshot(),
    };
    compare("bayes/reliability/observe-weight", reliabilitySnapshot, referenceReliabilitySnapshot, { prior: { alpha: 3, beta: 1 } });

    const vendorLoaded = new vendorBayesReliability.SourceReliability();
    const referenceLoaded = new refBayesReliability.SourceReliability();
    vendorLoaded.load(vendorReliability.snapshot());
    referenceLoaded.load(referenceReliability.snapshot());
    compare("bayes/reliability/load-snapshot", vendorLoaded.weights(), referenceLoaded.weights(), vendorReliability.snapshot());
}

async function runAttention(): Promise<void> {
    const candidates: Candidate[] = [
        makeCandidate("concept.high", { voi: 0.95, goalFit: 0.9, costTokens: 100, risk: 0.05 }),
        makeCandidate("concept.trust-capped", { voi: 1, goalFit: 1, costTokens: 0, risk: 0, trustCap: 0.25 }),
        makeCandidate("concept.expensive", { voi: 0.8, goalFit: 0.7, costTokens: 5000, risk: 0.2 }),
        makeCandidate("concept.risky", { voi: 0.8, goalFit: 0.7, costTokens: 100, risk: 0.95 }),
    ];
    for (let index: number = 0; index < candidates.length; index += 1) {
        const candidate: Candidate = candidates[index];
        compare(
            `attention/salience/${candidate.target.id}`,
            vendorAttention.salience(candidate),
            refAttention.salience(candidate),
            candidate,
        );
    }
    for (let index: number = 0; index < candidates.length; index += 1) {
        const candidate: Candidate = candidates[index];
        compare(
            `attention/monotonicity/${candidate.target.id}`,
            vendorAttention.respectsMonotonicity(candidate),
            refAttention.respectsMonotonicity(candidate),
            candidate,
        );
    }

    const selectionCandidates: Candidate[] = [
        makeCandidate("concept.alpha", { voi: 0.9, goalFit: 0.9, costTokens: 200, risk: 0.05 }),
        makeCandidate("concept.beta", { voi: 0.85, goalFit: 0.8, costTokens: 150, risk: 0.1 }),
        makeCandidate("concept.gamma", { voi: 0.7, goalFit: 0.7, costTokens: 120, risk: 0.05 }),
        makeCandidate("concept.delta", { voi: 0.6, goalFit: 0.6, costTokens: 90, risk: 0.05 }),
        makeCandidate("concept.epsilon", { voi: 0.05, goalFit: 0.2, costTokens: 10, risk: 0 }),
        makeCandidate("concept.zeta", { voi: 0.5, goalFit: 0.5, costTokens: 500, risk: 0.1 }),
    ];
    const selectionOptions: SelectionOptions = { budgetTokens: 400, cap: 3, threshold: 0.12 };
    const vendorSelection: Selection = vendorAttention.selectFocus(selectionCandidates, selectionOptions);
    const referenceSelection: Selection = refAttention.selectFocus(selectionCandidates, selectionOptions);
    compare("attention/select-focus", vendorSelection, referenceSelection, { candidates: selectionCandidates, options: selectionOptions });

    const tieCandidates: Candidate[] = [
        makeCandidate("concept.tie-a", { voi: 0.9, goalFit: 0.9, costTokens: 100, risk: 0.05 }),
        makeCandidate("concept.tie-b", { voi: 0.9, goalFit: 0.9, costTokens: 100, risk: 0.05 }),
    ];
    compare(
        "attention/select-focus-tie",
        vendorAttention.selectFocus(tieCandidates, { budgetTokens: 500 }),
        refAttention.selectFocus(tieCandidates, { budgetTokens: 500 }),
        tieCandidates,
    );

    const lowCandidates: Candidate[] = [makeCandidate("concept.low-a", { voi: 0.01, goalFit: 0.01, costTokens: 5000, risk: 0.9 })];
    compare(
        "attention/select-focus-stuck",
        vendorAttention.selectFocus(lowCandidates, { budgetTokens: 500 }),
        refAttention.selectFocus(lowCandidates, { budgetTokens: 500 }),
        lowCandidates,
    );

    const expensiveCandidates: Candidate[] = [makeCandidate("concept.only", { voi: 0.9, goalFit: 0.9, costTokens: 1000, risk: 0.05 })];
    compare(
        "attention/select-focus-budget-impasse",
        vendorAttention.selectFocus(expensiveCandidates, { budgetTokens: 100 }),
        refAttention.selectFocus(expensiveCandidates, { budgetTokens: 100 }),
        expensiveCandidates,
    );

    const attentionOptions: AttentionOptions = {
        subject: { pid: 42, tid: 7 },
        capacity: { slots: 3, tokens: 1200 },
        items: [
            { target: { kind: "concept", id: "concept.one" }, order: 1, weight: 0.9 },
            { target: { kind: "concept", id: "concept.two" }, order: 2, weight: 0.5, pinned: true },
            { target: { kind: "concept", id: "concept.three" }, order: 3, weight: 0.3 },
        ] as AttentionItem[],
        now: (): string => {
            return FixtureTimestamp;
        },
    };
    const vendorState = new vendorAttention.Attention(attentionOptions);
    const referenceState = new refAttention.Attention(attentionOptions);
    compare("attention/initial-snapshot", vendorState.snapshot(), referenceState.snapshot(), attentionOptions);
    vendorState.observe({ kind: "attraction", from: { kind: "agent", id: "agent.calendar" }, target: { kind: "concept", id: "concept.four" }, strength: 0.6 });
    referenceState.observe({ kind: "attraction", from: { kind: "agent", id: "agent.calendar" }, target: { kind: "concept", id: "concept.four" }, strength: 0.6 });
    compare("attention/observe-attraction", vendorState.snapshot(), referenceState.snapshot(), "attraction concept.four");
    compare("attention/focus", vendorState.focus(), referenceState.focus(), "focus");
    compare(
        "attention/shift-right",
        vendorState.shift({ actionId: "act.shift.1", direction: "right", steps: 2, reason: "fixture" }),
        referenceState.shift({ actionId: "act.shift.1", direction: "right", steps: 2, reason: "fixture" }),
        { actionId: "act.shift.1", direction: "right", steps: 2 },
    );
    compare(
        "attention/shift-left",
        vendorState.shift({ actionId: "act.shift.2", direction: "left", steps: 1, reason: "fixture" }),
        referenceState.shift({ actionId: "act.shift.2", direction: "left", steps: 1, reason: "fixture" }),
        { actionId: "act.shift.2", direction: "left", steps: 1 },
    );
    compare("attention/shift-action-plan", vendorAttention.toShiftAction({ actionId: "act.shift.3", direction: "right", reason: "fixture" }), refAttention.toShiftAction({ actionId: "act.shift.3", direction: "right", reason: "fixture" }), "toShiftAction");
    vendorState.close();
    referenceState.close();
    compare("attention/closed-snapshot", vendorState.snapshot(), referenceState.snapshot(), "close");
    compare(
        "attention/shift-after-close",
        captureSync(() => {
            return vendorState.shift({ actionId: "act.shift.4", direction: "left", reason: "after close" });
        }),
        captureSync(() => {
            return referenceState.shift({ actionId: "act.shift.4", direction: "left", reason: "after close" });
        }),
        "shift after close",
    );

    const vendorDispatcher = new vendorBudget.Dispatcher({ tokens: 100, calls: 3, ms: 50 });
    const referenceDispatcher = new refBudget.Dispatcher({ tokens: 100, calls: 3, ms: 50 });
    const vendorFirst = {
        value: vendorDispatcher.run(() => {
            return "first";
        }, { tokens: 30, calls: 1, ms: 10 }),
        usage: vendorDispatcher.usage(),
        remaining: vendorDispatcher.remaining(),
    };
    const referenceFirst = {
        value: referenceDispatcher.run(() => {
            return "first";
        }, { tokens: 30, calls: 1, ms: 10 }),
        usage: referenceDispatcher.usage(),
        remaining: referenceDispatcher.remaining(),
    };
    compare("attention/budget/charge", vendorFirst, referenceFirst, { tokens: 30, calls: 1, ms: 10 });

    const vendorTokensOverrun = captureSync(() => {
        return vendorDispatcher.run(() => {
            return "never";
        }, { tokens: 71 });
    });
    const referenceTokensOverrun = captureSync(() => {
        return referenceDispatcher.run(() => {
            return "never";
        }, { tokens: 71 });
    });
    compare("attention/budget/tokens-overrun", vendorTokensOverrun, referenceTokensOverrun, { tokens: 71 });

    const vendorCalls = new vendorBudget.Dispatcher({ tokens: 100, calls: 3, ms: 50 });
    const referenceCalls = new refBudget.Dispatcher({ tokens: 100, calls: 3, ms: 50 });
    vendorCalls.run(() => {
        return null;
    }, { calls: 2 });
    referenceCalls.run(() => {
        return null;
    }, { calls: 2 });
    compare(
        "attention/budget/calls-overrun",
        captureSync(() => {
            return vendorCalls.run(() => {
                return null;
            }, { calls: 2 });
        }),
        captureSync(() => {
            return referenceCalls.run(() => {
                return null;
            }, { calls: 2 });
        }),
        { calls: 2 },
    );

    const vendorMs = new vendorBudget.Dispatcher({ tokens: 100, calls: 3, ms: 10 });
    const referenceMs = new refBudget.Dispatcher({ tokens: 100, calls: 3, ms: 10 });
    compare(
        "attention/budget/ms-overrun",
        captureSync(() => {
            return vendorMs.run(() => {
                return null;
            }, { ms: 11 });
        }),
        captureSync(() => {
            return referenceMs.run(() => {
                return null;
            }, { ms: 11 });
        }),
        { ms: 11 },
    );
}

async function runLedger(): Promise<void> {
    const appendEvents: AmpEvent[] = [
        {
            amp: "0.1",
            kind: "event",
            id: "evt.append.3",
            at: "2026-10-29T00:00:09.000Z",
            actor: { kind: "agent", id: "agent.calendar" },
            type: "account",
            digest: vendorSemantics.digestOf({ seq: 3, verb: "account" }),
            payload: { tokens: 240, note: "结算：第三行" },
        },
        {
            amp: "0.1",
            kind: "event",
            id: "evt.append.1",
            at: "2026-10-29T00:00:07.000Z",
            actor: { kind: "agent", id: "agent.calendar" },
            type: "attend",
            digest: vendorSemantics.digestOf({ seq: 1, verb: "attend" }),
            payload: { intent: "import lunar table", level: "L1" },
        },
        {
            amp: "0.1",
            kind: "event",
            id: "evt.append.2",
            at: "2026-10-29T00:00:08.000Z",
            actor: { kind: "agent", id: "agent.calendar" },
            type: "act",
            caused_by: "evt.append.1",
            digest: vendorSemantics.digestOf({ seq: 2, verb: "act" }),
            payload: { affordance: "files.read", rows: 1247 },
        },
    ];
    const vendorAppendBook: InstanceType<LedgerModule["Ledger"]> = new vendorLedger.Ledger();
    const referenceAppendBook: InstanceType<LedgerModule["Ledger"]> = new refLedger.Ledger();
    for (let index: number = 0; index < appendEvents.length; index += 1) {
        vendorAppendBook.appendEvent(appendEvents[index]);
        referenceAppendBook.appendEvent(appendEvents[index]);
    }
    compare("ledger/append-event/events", vendorAppendBook.events, referenceAppendBook.events, appendEvents);
    const eventSummary = (events: AmpEvent[]): Record<string, unknown>[] => {
        return events.map((event: AmpEvent): Record<string, unknown> => {
            return { id: event.id, at: event.at, type: event.type, digest: event.digest };
        });
    };
    compare(
        "ledger/append-event/order-digests",
        eventSummary(vendorAppendBook.events),
        eventSummary(referenceAppendBook.events),
        appendEvents.map((event: AmpEvent): string => {
            return event.id;
        }),
    );
    const vendorAppendSnapshot: LedgerSnapshot = vendorLedgerPersistence.exportLedger(vendorAppendBook, "agent.calendar");
    const referenceAppendSnapshot: LedgerSnapshot = refLedgerPersistence.exportLedger(referenceAppendBook, "agent.calendar");
    compare("ledger/append-event/export-chain", vendorAppendSnapshot, referenceAppendSnapshot, vendorAppendSnapshot.tip);
    record(
        "ledger/append-event/tip",
        vendorAppendSnapshot.tip === referenceAppendSnapshot.tip,
        vendorAppendSnapshot.tip === referenceAppendSnapshot.tip
            ? `vendor=${vendorAppendSnapshot.tip} lib=${referenceAppendSnapshot.tip}`
            : `vendor=${vendorAppendSnapshot.tip} lib=${referenceAppendSnapshot.tip} repro=${display(
                  appendEvents.map((event: AmpEvent): string => {
                      return event.id;
                  }),
              )}`,
    );

    const buildLedger = (module: LedgerModule): InstanceType<LedgerModule["Ledger"]> => {
        const ledger = new module.Ledger();
        const eventA: AmpEvent = {
            amp: "0.1",
            kind: "event",
            id: "evt.1",
            at: "2026-10-29T00:00:02.000Z",
            actor: { kind: "agent", id: "agent.calendar" },
            type: "attend",
            digest: DigestB,
            payload: { intent: "import lunar table" },
        };
        const eventB: AmpEvent = {
            amp: "0.1",
            kind: "event",
            id: "evt.2",
            at: "2026-10-29T00:00:04.000Z",
            actor: { kind: "agent", id: "agent.calendar" },
            type: "act",
            caused_by: "evt.1",
            refs: [{ kind: "tool", id: "mcp.files.read" }],
            digest: DigestA,
            payload: { path: "lunar.csv", rows: 1247 },
        };
        const frame: Frame = {
            amp: "0.1",
            kind: "frame",
            id: "frame.1",
            agent: "agent.calendar",
            cycle: 0,
            ts: "2026-10-29T00:00:01.000Z",
            digest: DigestA,
            mode: "explore",
            goal: { kind: "goal", id: "goal.import" },
            slots: [
                {
                    target: { kind: "concept", id: "concept.lunar-table" },
                    role: "concept",
                    salience: 0.8,
                    voi: 0.6,
                    cost: { tokens: 10 },
                    why: "fixture slot",
                    state: "active",
                },
            ],
            budget: { allocated: { tokens: 100 }, spent: { tokens: 10 } },
        };
        const claim: Claim = {
            ...makeClaim("T1", 0.8),
            created: "2026-10-29T00:00:03.000Z",
        };
        const receipt: Receipt = {
            amp: "0.1",
            kind: "receipt",
            id: "rcpt.1",
            op: "read",
            target: { kind: "tool", id: "mcp.files.read" },
            at: "2026-10-29T00:00:05.000Z",
            ms: 42,
            usage: { tokens: 120, calls: 1, ms: 42 },
            outcome: "success",
            predicted_voi: 0.5,
            realized_voi: 0.7,
        };
        ledger.events.push(eventA, eventB);
        ledger.frames.push(frame);
        ledger.claims.push(claim);
        ledger.receipts.push(receipt);
        return ledger;
    };

    const vendorBook: InstanceType<LedgerModule["Ledger"]> = buildLedger(vendorLedger);
    const referenceBook: InstanceType<LedgerModule["Ledger"]> = buildLedger(refLedger);
    const vendorSnapshot: LedgerSnapshot = vendorLedgerPersistence.exportLedger(vendorBook, "agent.calendar");
    const referenceSnapshot: LedgerSnapshot = refLedgerPersistence.exportLedger(referenceBook, "agent.calendar");
    compare("ledger/export-chain", vendorSnapshot, referenceSnapshot, { agent: "agent.calendar" });

    const vendorExportAgain: LedgerSnapshot = vendorLedgerPersistence.exportLedger(vendorBook, "agent.calendar");
    const referenceExportAgain: LedgerSnapshot = refLedgerPersistence.exportLedger(referenceBook, "agent.calendar");
    compare("ledger/export-deterministic", vendorExportAgain, referenceExportAgain, "second export");

    const vendorVerdict = vendorLedgerPersistence.verifySnapshot(vendorSnapshot);
    const referenceVerdict = refLedgerPersistence.verifySnapshot(referenceSnapshot);
    compare("ledger/verify-snapshot", vendorVerdict, referenceVerdict, vendorSnapshot);

    const vendorRestored = vendorLedgerPersistence.restoreLedger(vendorSnapshot);
    const referenceRestored = refLedgerPersistence.restoreLedger(referenceSnapshot);
    compare("ledger/restore-snapshot", vendorRestored, referenceRestored, vendorSnapshot);

    const tamperedPayload: LedgerSnapshot = cloneSnapshot(vendorSnapshot);
    const entry: ChainEntry = tamperedPayload.entries[1];
    const payload: Record<string, unknown> = entry.payload as Record<string, unknown>;
    tamperedPayload.entries[1] = { ...entry, payload: { ...payload, rows: 9999 } };
    const vendorTamperedPayload = vendorLedgerPersistence.verifySnapshot(tamperedPayload);
    const referenceTamperedPayload = refLedgerPersistence.verifySnapshot(tamperedPayload);
    compare("ledger/verify-tampered-payload", vendorTamperedPayload, referenceTamperedPayload, { entry: 1, payload: { rows: 9999 } });

    const tamperedTip: LedgerSnapshot = { ...vendorSnapshot, tip: `sha256:${"f".repeat(64)}` };
    compare(
        "ledger/verify-tampered-tip",
        vendorLedgerPersistence.verifySnapshot(tamperedTip),
        refLedgerPersistence.verifySnapshot(tamperedTip),
        { tip: tamperedTip.tip },
    );

    const vendorRestoreTampered = captureSync(() => {
        return vendorLedgerPersistence.restoreLedger(tamperedPayload);
    });
    const referenceRestoreTampered = captureSync(() => {
        return refLedgerPersistence.restoreLedger(tamperedPayload);
    });
    compare("ledger/restore-refuses-tampered", vendorRestoreTampered, referenceRestoreTampered, { entry: 1 });

    const checkpointOptions: CheckpointOptions = { tenant: "tenant.calendar", issued: LaterTimestamp };
    const vendorCheckpoint: LedgerCheckpoint = await vendorLedgerCheckpoint.sealCheckpoint(vendorSnapshot, FixedKey, checkpointOptions);
    const referenceCheckpoint: LedgerCheckpoint = await refLedgerCheckpoint.sealCheckpoint(referenceSnapshot, FixedKey, checkpointOptions);
    compare("ledger/checkpoint-seal", vendorCheckpoint, referenceCheckpoint, checkpointOptions);
    compare(
        "ledger/checkpoint-body",
        vendorLedgerCheckpoint.checkpointBody(vendorCheckpoint),
        refLedgerCheckpoint.checkpointBody(referenceCheckpoint),
        vendorCheckpoint,
    );
    compare(
        "ledger/checkpoint-digest",
        vendorLedgerCheckpoint.checkpointDigest(vendorCheckpoint),
        refLedgerCheckpoint.checkpointDigest(referenceCheckpoint),
        vendorCheckpoint,
    );

    const vendorCheckpointVerdict = await vendorLedgerCheckpoint.verifyCheckpoint(vendorCheckpoint, FixedPublicKey);
    const referenceCheckpointVerdict = await refLedgerCheckpoint.verifyCheckpoint(referenceCheckpoint, FixedPublicKey);
    compare("ledger/checkpoint-verify", vendorCheckpointVerdict, referenceCheckpointVerdict, vendorCheckpoint);

    const tamperedCheckpoint: LedgerCheckpoint = { ...vendorCheckpoint, count: vendorCheckpoint.count + 1 };
    const vendorTamperedCheckpoint = await vendorLedgerCheckpoint.verifyCheckpoint(tamperedCheckpoint, FixedPublicKey);
    const referenceTamperedCheckpoint = await refLedgerCheckpoint.verifyCheckpoint(tamperedCheckpoint, FixedPublicKey);
    compare("ledger/checkpoint-verify-tampered", vendorTamperedCheckpoint, referenceTamperedCheckpoint, { count: tamperedCheckpoint.count });

    const vendorSnapshotAgainst = await vendorLedgerCheckpoint.verifySnapshotAgainstCheckpoint(vendorSnapshot, vendorCheckpoint);
    const referenceSnapshotAgainst = await refLedgerCheckpoint.verifySnapshotAgainstCheckpoint(referenceSnapshot, referenceCheckpoint);
    compare("ledger/checkpoint-against-snapshot", vendorSnapshotAgainst, referenceSnapshotAgainst, vendorCheckpoint);

    const nextReceipt: Receipt = {
        amp: "0.1",
        kind: "receipt",
        id: "rcpt.2",
        op: "act",
        target: { kind: "tool", id: "mcp.files.read" },
        at: "2026-10-29T00:00:06.000Z",
        usage: { tokens: 30, calls: 1, ms: 8 },
        outcome: "partial",
        note: "schema mismatch on row 42",
    };
    vendorBook.receipts.push(nextReceipt);
    referenceBook.receipts.push(nextReceipt);
    const vendorSnapshot2: LedgerSnapshot = vendorLedgerPersistence.exportLedger(vendorBook, "agent.calendar");
    const referenceSnapshot2: LedgerSnapshot = refLedgerPersistence.exportLedger(referenceBook, "agent.calendar");
    compare("ledger/export-chain-second", vendorSnapshot2, referenceSnapshot2, nextReceipt);

    const vendorCheckpoint2: LedgerCheckpoint = await vendorLedgerCheckpoint.sealCheckpoint(vendorSnapshot2, FixedKey, {
        tenant: "tenant.calendar",
        issued: "2026-10-29T00:06:00.000Z",
        previous: vendorCheckpoint,
    });
    const referenceCheckpoint2: LedgerCheckpoint = await refLedgerCheckpoint.sealCheckpoint(referenceSnapshot2, FixedKey, {
        tenant: "tenant.calendar",
        issued: "2026-10-29T00:06:00.000Z",
        previous: referenceCheckpoint,
    });
    compare("ledger/checkpoint-chain", vendorCheckpoint2, referenceCheckpoint2, { previous: vendorCheckpoint });
    compare(
        "ledger/checkpoint-chain-verify",
        await vendorLedgerCheckpoint.verifyCheckpoint(vendorCheckpoint2, FixedPublicKey, vendorCheckpoint),
        await refLedgerCheckpoint.verifyCheckpoint(referenceCheckpoint2, FixedPublicKey, referenceCheckpoint),
        vendorCheckpoint2,
    );
    compare(
        "ledger/checkpoint-chain-against-snapshot",
        await vendorLedgerCheckpoint.verifySnapshotAgainstCheckpoint(vendorSnapshot2, vendorCheckpoint2),
        await refLedgerCheckpoint.verifySnapshotAgainstCheckpoint(referenceSnapshot2, referenceCheckpoint2),
        vendorCheckpoint2,
    );

    const vendorReplay = vendorLedgerPersistence.restoreLedger(vendorSnapshot2);
    const referenceReplay = refLedgerPersistence.restoreLedger(referenceSnapshot2);
    compare("ledger/replay-terminal-state", vendorReplay, referenceReplay, vendorSnapshot2);
}

async function runReceiptAndHandles(): Promise<void> {
    const receipt: Receipt = {
        amp: "0.1",
        kind: "receipt",
        id: "rcpt.handle.1",
        op: "read",
        target: { kind: "handle", id: "h.0123456789" },
        at: FixtureTimestamp,
        ms: 17,
        usage: { tokens: 240, calls: 1, ms: 17, money: 0.001 },
        outcome: "success",
        predicted_voi: 0.4,
        realized_voi: 0.55,
        note: "paged read",
    };
    compare("receipt/canonical", vendorSemantics.canonical(receipt), refSemantics.canonical(receipt), receipt);
    compare("receipt/digest", vendorSemantics.digestOf(receipt), refSemantics.digestOf(receipt), receipt);

    const content: string = "行 1: 历法数据\n".repeat(60) + "final line";
    const vendorStore = new vendorHandles.HandleStore();
    const referenceStore = new refHandles.HandleStore();
    const vendorHandle: Handle = vendorStore.put(content, "text", 75, "task", 60000);
    const referenceHandle: Handle = referenceStore.put(content, "text", 75, "task", 60000);
    compare("execution/handle-put", vendorHandle, referenceHandle, { kind: "text", tokens: 75, scope: "task" });

    const vendorPages = [vendorStore.read(vendorHandle.id, 0, 5), vendorStore.read(vendorHandle.id, 120, 5), vendorStore.read(vendorHandle.id, 99999, 5)];
    const referencePages = [
        referenceStore.read(referenceHandle.id, 0, 5),
        referenceStore.read(referenceHandle.id, 120, 5),
        referenceStore.read(referenceHandle.id, 99999, 5),
    ];
    compare("execution/handle-paging", vendorPages, referencePages, { handle: vendorHandle.id, cursors: [0, 120, 99999] });

    const vendorHandleState = {
        has: vendorStore.has(vendorHandle.id),
        get: vendorStore.get(vendorHandle.id),
        missingHas: vendorStore.has("h.missing"),
        missingGet: vendorStore.get("h.missing"),
    };
    const referenceHandleState = {
        has: referenceStore.has(referenceHandle.id),
        get: referenceStore.get(referenceHandle.id),
        missingHas: referenceStore.has("h.missing"),
        missingGet: referenceStore.get("h.missing"),
    };
    compare("execution/handle-store-state", vendorHandleState, referenceHandleState, vendorHandle.id);
    compare(
        "execution/handle-unknown-read",
        captureSync(() => {
            return vendorStore.read("h.missing", 0);
        }),
        captureSync(() => {
            return referenceStore.read("h.missing", 0);
        }),
        "h.missing",
    );

    const vendorSecond: Handle = vendorStore.put("second body", "blob", 3);
    const referenceSecond: Handle = referenceStore.put("second body", "blob", 3);
    compare("execution/handle-second-put", vendorSecond, referenceSecond, { kind: "blob", tokens: 3 });
    record(
        "execution/handle-id-format",
        /^h\.[0-9a-f]{10}$/.test(vendorHandle.id) && /^h\.[0-9a-f]{10}$/.test(vendorSecond.id) && vendorHandle.id !== vendorSecond.id,
        `first=${vendorHandle.id} second=${vendorSecond.id}`,
    );
}

async function runBoundaryAndPolicy(): Promise<void> {
    const createRefs = (api: BoundaryRefTableModule): InstanceType<BoundaryRefTableModule["RefTable"]> => {
        const refs = new api.RefTable("run", "agent.calendar");
        refs.add("tool", "mcp.files.read", { kind: "tool", id: "mcp.files.read" });
        refs.add("concept", "concept.lunar-table", { kind: "concept", id: "concept.lunar-table" });
        refs.add("goal", "goal.import", { kind: "goal", id: "goal.import" });
        refs.add("claim", "claim.import", { kind: "claim", id: "claim.import" });
        return refs;
    };

    const vendorRefs = createRefs(vendorBoundaryRefTable);
    const referenceRefs = createRefs(refBoundaryRefTable);
    const toolRef: Ref = { kind: "tool", id: "mcp.files.read" };
    const vendorRefState = {
        hasTool: vendorRefs.has(toolRef),
        hasMissing: vendorRefs.has({ kind: "tool", id: "mcp.missing" }),
        resolveTool: vendorRefs.resolve(toolRef),
        resolvePrefixed: vendorRefs.resolve({ kind: "tool", id: "files.read" }),
        resolveSelf: vendorRefs.resolve({ kind: "self", id: "agent.calendar" }),
        checkTool: vendorRefs.check(toolRef),
        checkMissing: vendorRefs.check({ kind: "concept", id: "concept.missing" }),
    };
    const referenceRefState = {
        hasTool: referenceRefs.has(toolRef),
        hasMissing: referenceRefs.has({ kind: "tool", id: "mcp.missing" }),
        resolveTool: referenceRefs.resolve(toolRef),
        resolvePrefixed: referenceRefs.resolve({ kind: "tool", id: "files.read" }),
        resolveSelf: referenceRefs.resolve({ kind: "self", id: "agent.calendar" }),
        checkTool: referenceRefs.check(toolRef),
        checkMissing: referenceRefs.check({ kind: "concept", id: "concept.missing" }),
    };
    compare("boundary/ref-table", vendorRefState, referenceRefState, { toolRef, self: "agent.calendar" });
    compare(
        "boundary/ref-table-missing-require",
        captureSync(() => {
            return vendorRefs.require({ kind: "concept", id: "concept.missing" });
        }),
        captureSync(() => {
            return referenceRefs.require({ kind: "concept", id: "concept.missing" });
        }),
        { kind: "concept", id: "concept.missing" },
    );

    const frameDraft: FrameDraft = {
        id: "frame.boundary.1",
        agent: "agent.calendar",
        cycle: 0,
        ts: FixtureTimestamp,
        parent: { kind: "frame", id: "frame.parent" },
        mode: "explore",
        goal: { kind: "goal", id: "goal.import" },
        slots: [
            {
                target: { kind: "self", id: "agent.calendar" },
                role: "self",
                salience: 0.9,
                voi: 0.5,
                cost: { tokens: 10 },
                why: "who is acting",
                state: "active",
            },
            {
                target: { kind: "tool", id: "mcp.files.read" },
                role: "tool",
                tier: "T2",
                salience: 0.7,
                voi: 0.8,
                cost: { tokens: 20 },
                why: "read the source",
                state: "active",
            },
        ],
        ignored: [
            { target: { kind: "concept", id: "concept.lunar-table" }, reason: "low_voi", revisit_if: "voi rises" },
            { target: { kind: "claim", id: "claim.import" }, reason: "untrusted", revisit_if: "trust is verified" },
        ],
        budget: { allocated: { tokens: 100, calls: 5 }, spent: { tokens: 30, calls: 1 } },
        open_questions: [{ kind: "claim", id: "claim.import" }],
        note: "boundary fixture",
    };

    vendorRefs.add("frame", "frame.parent", { kind: "frame", id: "frame.parent" });
    referenceRefs.add("frame", "frame.parent", { kind: "frame", id: "frame.parent" });
    const vendorFrameResult = vendorBoundaryFrame.frameFrom(frameDraft, vendorRefs, { maxIgnored: 1, now: (): string => {
        return FixtureTimestamp;
    } });
    const referenceFrameResult = refBoundaryFrame.frameFrom(frameDraft, referenceRefs, { maxIgnored: 1, now: (): string => {
        return FixtureTimestamp;
    } });
    compare("boundary/frame-build", vendorFrameResult, referenceFrameResult, frameDraft);

    const invalidDraft: FrameDraft = {
        ...frameDraft,
        id: "not an id",
        slots: [
            {
                ...frameDraft.slots[0],
                target: { kind: "tool", id: "mcp.missing" },
                why: "",
                salience: 1.5,
            },
            frameDraft.slots[1],
        ],
        budget: { allocated: { tokens: 10 }, spent: { tokens: 11 } },
    };
    compare(
        "boundary/frame-rejections",
        captureSync(() => {
            return vendorBoundaryFrame.frameFrom(invalidDraft, vendorRefs, { maxSlots: 1, maxIgnored: 0 });
        }),
        captureSync(() => {
            return refBoundaryFrame.frameFrom(invalidDraft, referenceRefs, { maxSlots: 1, maxIgnored: 0 });
        }),
        invalidDraft,
    );

    const toolSchema: ToolSchema = {
        name: "files.read",
        inputSchema: {
            type: "object",
            required: ["path", "limit"],
            additionalProperties: false,
            properties: {
                path: { type: "string", minLength: 1, pattern: "^/" },
                limit: { type: "integer", minimum: 1, maximum: 100 },
                tags: { type: "array", minItems: 1, items: { enum: ["lunar", "solar"] } },
                nested: {
                    type: "object",
                    required: ["ok"],
                    properties: { ok: { const: true }, note: { type: "string", maxLength: 10 } },
                },
            },
        },
    };
    const validArgs: Record<string, unknown> = {
        path: "/data/lunar.csv",
        limit: 50,
        tags: ["lunar"],
        nested: { ok: true, note: "fine" },
    };
    compare(
        "boundary/tool-call-valid",
        vendorBoundaryToolCall.parseToolCall(toolSchema, validArgs),
        refBoundaryToolCall.parseToolCall(toolSchema, validArgs),
        { tool: toolSchema, raw: validArgs },
    );

    const invalidArgs: Record<string, unknown> = {
        path: "relative",
        limit: 0,
        extra: true,
        tags: [],
        nested: { ok: false, note: "too long for the schema" },
    };
    compare(
        "boundary/tool-call-rejections",
        captureSync(() => {
            return vendorBoundaryToolCall.parseToolCall(toolSchema, invalidArgs);
        }),
        captureSync(() => {
            return refBoundaryToolCall.parseToolCall(toolSchema, invalidArgs);
        }),
        { tool: toolSchema, raw: invalidArgs },
    );
    compare(
        "boundary/tool-call-not-object",
        captureSync(() => {
            return vendorBoundaryToolCall.parseToolCall(toolSchema, "not an object");
        }),
        captureSync(() => {
            return refBoundaryToolCall.parseToolCall(toolSchema, "not an object");
        }),
        "not an object",
    );

    interface PolicyObservation {
        verdicts: unknown[];
        approvals: unknown[];
    }

    const normalizePolicyVerdict = (verdict: PolicyVerdict): Record<string, unknown> => {
        const normalized: Record<string, unknown> = {
            outcome: verdict.outcome,
            reason: verdict.reason,
            minTier: verdict.minTier,
        };
        if (verdict.approvalId !== (void 0)) {
            normalized.approvalId = "<approval>";
        }
        return normalized;
    };

    const shapeApproval = (approval: Approval): Record<string, unknown> => {
        return {
            idPrefix: approval.id.startsWith("apr."),
            idLength: approval.id.length,
            action: approval.action,
            effect: approval.effect,
            scope: approval.scope,
            approvedBy: approval.approvedBy,
            issued: approval.issued,
            expires: approval.expires,
            nonceLength: approval.nonce.length,
        };
    };

    const runPolicyScenario = (api: PolicyModule): PolicyObservation => {
        let nowMs: number = Date.parse(FixtureTimestamp);
        const now = (): string => {
            return new Date(nowMs).toISOString();
        };
        const engine = new api.PolicyEngine({ now });
        const verdicts: unknown[] = [];
        const approvals: unknown[] = [];
        const push = (verdict: PolicyVerdict): void => {
            verdicts.push(normalizePolicyVerdict(verdict));
        };

        push(engine.decide({ action: "files.read", effect: "read" }));
        push(engine.decide({ action: "files.write", effect: "write-reversible" }));
        push(engine.decide({ action: "files.write", effect: "write-reversible", claim: makeClaim("T1", 0.9) }));
        push(engine.decide({ action: "budget.spend", effect: "spend", claim: makeClaim("T1", 0.9) }));
        push(engine.decide({ action: "budget.spend", effect: "spend", claim: makeClaim("T2", 0.5) }));
        push(engine.decide({ action: "records.delete", effect: "delete", claim: makeClaim("T3", 0.9) }));

        const deleteApproval: Approval = engine.approve({ action: "records.delete", effect: "delete", approvedBy: "human.owner" });
        approvals.push(shapeApproval(deleteApproval));
        push(engine.decide({ action: "records.delete", effect: "delete", claim: makeClaim("T3", 0.9) }, deleteApproval));
        push(engine.decide({ action: "records.delete", effect: "delete", claim: makeClaim("T3", 0.9) }, deleteApproval));

        const sendApproval: Approval = engine.approve({
            action: "mail.send",
            effect: "send",
            approvedBy: "human.owner",
            argsDigest: DigestA,
        });
        approvals.push(shapeApproval(sendApproval));
        push(
            engine.checkApproval(sendApproval, {
                action: "mail.send",
                effect: "send",
                claim: makeClaim("T2", 0.9),
                argsDigest: DigestA,
            }),
        );
        push(
            engine.checkApproval(sendApproval, {
                action: "mail.send",
                effect: "send",
                claim: makeClaim("T2", 0.9),
                argsDigest: DigestA,
            }),
        );
        push(
            engine.decide(
                { action: "mail.send", effect: "send", claim: makeClaim("T2", 0.9), argsDigest: DigestB },
                sendApproval,
            ),
        );
        push(
            engine.decide(
                { action: "mail.send", effect: "send", claim: makeClaim("T2", 0.9), argsDigest: DigestA },
                sendApproval,
            ),
        );

        const deployApproval: Approval = engine.approve({
            action: "site.deploy",
            effect: "deploy",
            approvedBy: "human.owner",
            ttlMs: 1000,
        });
        approvals.push(shapeApproval(deployApproval));
        nowMs += 2000;
        push(engine.decide({ action: "site.deploy", effect: "deploy", claim: makeClaim("T3", 0.9) }, deployApproval));

        const permissionApproval: Approval = engine.approve({
            action: "role.grant",
            effect: "permission",
            approvedBy: "human.owner",
        });
        approvals.push(shapeApproval(permissionApproval));
        const revokeResult: boolean = engine.revoke(permissionApproval.id);
        verdicts.push({ revoked: revokeResult });
        push(engine.decide({ action: "role.grant", effect: "permission", claim: makeClaim("T3", 0.9) }, permissionApproval));

        push(
            engine.decide({
                action: "claim.publish",
                effect: "publish",
                claim: makeClaim("T3", 0.9),
                minTier: "T4",
            }),
        );
        push(engine.decide({ action: "unknown.action", effect: "teleport" as EffectClass }));

        const writeApproval: Approval = engine.approve({
            action: "files.write",
            effect: "write-reversible",
            approvedBy: "human.owner",
        });
        approvals.push(shapeApproval(writeApproval));
        push(
            engine.consume(writeApproval.id, {
                action: "files.write",
                effect: "write-reversible",
                claim: makeClaim("T1", 0.9),
            }),
        );

        const strictEngine = new api.PolicyEngine({ now, allowReadWithoutClaim: false });
        push(strictEngine.decide({ action: "files.read", effect: "read" }));

        const staleEngine = new api.PolicyEngine({
            now,
            isClaimCurrent: (): boolean => {
                return false;
            },
        });
        push(staleEngine.decide({ action: "files.write", effect: "write-reversible", claim: makeClaim("T1", 0.9) }));

        return { verdicts, approvals };
    };

    compare("policy/decision-matrix", runPolicyScenario(vendorPolicy), runPolicyScenario(refPolicy), "policy scenario matrix");

    interface GuardObservation {
        snapshots: unknown[];
        errors: Capture[];
    }

    const runGuardScenario = (api: PolicyModule): GuardObservation => {
        let nowMs: number = 0;
        const guard = new api.Guard({
            now: (): number => {
                return nowMs;
            },
            rate: { limit: 2, intervalMs: 1000 },
            breaker: { failures: 2, cooldownMs: 500 },
            costCeiling: 10,
        });
        const snapshots: unknown[] = [];
        const errors: Capture[] = [];
        guard.beforeDispatch({ money: 1 });
        snapshots.push(guard.snapshot());
        guard.beforeDispatch();
        errors.push(
            captureSync(() => {
                return guard.beforeDispatch();
            }),
        );
        nowMs += 1000;
        guard.beforeDispatch();
        snapshots.push(guard.snapshot());
        guard.recordFailure();
        guard.recordFailure();
        errors.push(
            captureSync(() => {
                return guard.beforeDispatch();
            }),
        );
        nowMs += 500;
        guard.beforeDispatch();
        guard.recordSuccess();
        nowMs += 1000;
        guard.beforeDispatch({ money: 6 });
        errors.push(
            captureSync(() => {
                return guard.beforeDispatch({ money: 5 });
            }),
        );
        snapshots.push(guard.snapshot());
        return { snapshots, errors };
    };

    compare("policy/guard-controls", runGuardScenario(vendorPolicy), runGuardScenario(refPolicy), "guard scenario");
}

async function runProtocolAndWire(): Promise<void> {
    const fromRef: Ref = { kind: "agent", id: "agent.alpha" };
    const toRef: Ref = { kind: "agent", id: "agent.beta" };
    const envelopeInput: EnvelopeInput<unknown> = {
        id: "m.fixed",
        from: fromRef,
        to: toRef,
        thread: "thread.1",
        seq: 0,
        type: "inform",
        sent: FixtureTimestamp,
        ttlMs: 60000,
        nonce: FixedNonce,
        version: { min: "0.1", max: "0.2" },
        payload: { claim: { kind: "claim", id: "claim.import" }, why_now: "source arrived", note: "值" },
        kid: FixedKey.kid,
    };
    const vendorSealed: SealedEnvelope = await vendorEnvelope.sealEnvelope(envelopeInput, FixedKey);
    const referenceSealed: SealedEnvelope = await refEnvelope.sealEnvelope(envelopeInput, FixedKey);
    compare("protocol/envelope-seal", vendorSealed, referenceSealed, envelopeInput);
    record(
        "protocol/envelope-signature-bytes",
        vendorSealed.sig === referenceSealed.sig,
        `vendor=${vendorSealed.sig} lib=${referenceSealed.sig}`,
    );
    compare("protocol/envelope-digest", vendorEnvelope.envelopeDigest(vendorSealed), refEnvelope.envelopeDigest(referenceSealed), vendorSealed);

    const vendorSeenNonces: Set<string> = new Set<string>();
    const referenceSeenNonces: Set<string> = new Set<string>();
    const vendorVerify = await vendorEnvelope.verifyEnvelope(vendorSealed, FixedPublicKey, {
        now: FixtureTimestamp,
        expectedVersion: { min: "0.1", max: "0.2" },
        seenNonces: vendorSeenNonces,
    });
    const referenceVerify = await refEnvelope.verifyEnvelope(referenceSealed, FixedPublicKey, {
        now: FixtureTimestamp,
        expectedVersion: { min: "0.1", max: "0.2" },
        seenNonces: referenceSeenNonces,
    });
    compare("protocol/envelope-verify", vendorVerify, referenceVerify, vendorSealed);
    compare("protocol/envelope-seen-nonces", [...vendorSeenNonces], [...referenceSeenNonces], FixedNonce);

    const tamperedEnvelope: SealedEnvelope = {
        ...vendorSealed,
        payload: { claim: { kind: "claim", id: "claim.tampered" }, why_now: "tampered" },
    };
    compare(
        "protocol/envelope-tampered",
        await vendorEnvelope.verifyEnvelope(tamperedEnvelope, FixedPublicKey, { now: FixtureTimestamp }),
        await refEnvelope.verifyEnvelope(tamperedEnvelope, FixedPublicKey, { now: FixtureTimestamp }),
        tamperedEnvelope.payload,
    );

    const expiredNow: string = new Date(Date.parse(FixtureTimestamp) + 120000).toISOString();
    compare(
        "protocol/envelope-expired",
        await vendorEnvelope.verifyEnvelope(vendorSealed, FixedPublicKey, { now: expiredNow }),
        await refEnvelope.verifyEnvelope(referenceSealed, FixedPublicKey, { now: expiredNow }),
        { now: expiredNow },
    );
    const skewNow: string = new Date(Date.parse(FixtureTimestamp) + 90000).toISOString();
    compare(
        "protocol/envelope-clock-skew",
        await vendorEnvelope.verifyEnvelope(vendorSealed, FixedPublicKey, { now: skewNow, clockSkewMs: 60000 }),
        await refEnvelope.verifyEnvelope(referenceSealed, FixedPublicKey, { now: skewNow, clockSkewMs: 60000 }),
        { now: skewNow, clockSkewMs: 60000 },
    );
    compare(
        "protocol/envelope-version-mismatch",
        await vendorEnvelope.verifyEnvelope(vendorSealed, FixedPublicKey, {
            now: FixtureTimestamp,
            expectedVersion: { min: "0.2", max: "0.3" },
        }),
        await refEnvelope.verifyEnvelope(referenceSealed, FixedPublicKey, {
            now: FixtureTimestamp,
            expectedVersion: { min: "0.2", max: "0.3" },
        }),
        { expectedVersion: { min: "0.2", max: "0.3" } },
    );

    const versionCases: { left: { min: string; max: string }; right: { min: string; max: string } }[] = [
        { left: { min: "0.1", max: "0.1" }, right: { min: "0.1", max: "0.2" } },
        { left: { min: "0.2", max: "0.3" }, right: { min: "0.1", max: "0.2" } },
        { left: { min: "0.9", max: "0.10" }, right: { min: "0.9", max: "0.9" } },
        { left: { min: "1.0", max: "2.0" }, right: { min: "0.1", max: "1.5" } },
        { left: { min: "0.2", max: "0.1" }, right: { min: "0.1", max: "0.2" } },
    ];
    const vendorNegotiated = versionCases.map((entry) => {
        return vendorEnvelope.negotiateVersion(entry.left, entry.right);
    });
    const referenceNegotiated = versionCases.map((entry) => {
        return refEnvelope.negotiateVersion(entry.left, entry.right);
    });
    compare("protocol/version-negotiation", vendorNegotiated, referenceNegotiated, versionCases);

    const nonceHex = (index: number): string => {
        return index.toString(16).padStart(32, "0");
    };
    const sealForRuntime = async (
        api: EnvelopeModule,
        id: string,
        thread: string,
        seq: number,
        type: SealedEnvelope["type"],
        payload: unknown,
    ): Promise<SealedEnvelope> => {
        return await api.sealEnvelope(
            {
                id,
                from: fromRef,
                to: toRef,
                thread,
                seq,
                type,
                sent: FixtureTimestamp,
                nonce: nonceHex(seq + 1),
                payload,
                version: { min: "0.1", max: "0.1" },
            },
            FixedKey,
        );
    };

    const vendorRuntime = new vendorEnvelope.EnvelopeRuntime({
        now: (): string => {
            return FixtureTimestamp;
        },
        version: { min: "0.1", max: "0.1" },
    });
    const referenceRuntime = new refEnvelope.EnvelopeRuntime({
        now: (): string => {
            return FixtureTimestamp;
        },
        version: { min: "0.1", max: "0.1" },
    });
    const vendorSeq0: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.0", "thread.1", 0, "inform", { order: 0 });
    const referenceSeq0: SealedEnvelope = await sealForRuntime(refEnvelope, "m.0", "thread.1", 0, "inform", { order: 0 });
    const vendorSeq2: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.2", "thread.1", 2, "inform", { order: 2 });
    const referenceSeq2: SealedEnvelope = await sealForRuntime(refEnvelope, "m.2", "thread.1", 2, "inform", { order: 2 });
    const vendorSeq1: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.1", "thread.1", 1, "inform", { order: 1 });
    const referenceSeq1: SealedEnvelope = await sealForRuntime(refEnvelope, "m.1", "thread.1", 1, "inform", { order: 1 });
    const vendorSeq3: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.3", "thread.1", 3, "inform", { order: 3 });
    const referenceSeq3: SealedEnvelope = await sealForRuntime(refEnvelope, "m.3", "thread.1", 3, "inform", { order: 3 });

    const vendorOrderStatuses: string[] = [];
    const referenceOrderStatuses: string[] = [];
    const receiveOrder: { vendor: SealedEnvelope; reference: SealedEnvelope }[] = [
        { vendor: vendorSeq0, reference: referenceSeq0 },
        { vendor: vendorSeq2, reference: referenceSeq2 },
        { vendor: vendorSeq1, reference: referenceSeq1 },
        { vendor: vendorSeq3, reference: referenceSeq3 },
        { vendor: vendorSeq0, reference: referenceSeq0 },
    ];
    for (let index: number = 0; index < receiveOrder.length; index += 1) {
        const pair: { vendor: SealedEnvelope; reference: SealedEnvelope } = receiveOrder[index];
        const vendorVerdict = await vendorRuntime.receive(pair.vendor, FixedPublicKey);
        const referenceVerdict = await referenceRuntime.receive(pair.reference, FixedPublicKey);
        vendorOrderStatuses.push(`${vendorVerdict.status}:${vendorVerdict.reasons.join("|")}`);
        referenceOrderStatuses.push(`${referenceVerdict.status}:${referenceVerdict.reasons.join("|")}`);
    }
    compare("protocol/runtime-ordering", vendorOrderStatuses, referenceOrderStatuses, ["0", "2", "1", "3", "0"]);
    const deliveredIds = (items: readonly SealedEnvelope[]): string[] => {
        return items.map((item) => {
            return item.id;
        });
    };
    compare("protocol/runtime-delivered", deliveredIds(vendorRuntime.delivered), deliveredIds(referenceRuntime.delivered), "thread.1");
    compare("protocol/runtime-pending", deliveredIds(vendorRuntime.pending), deliveredIds(referenceRuntime.pending), "thread.1");

    const vendorCancelRuntime = new vendorEnvelope.EnvelopeRuntime({
        now: (): string => {
            return FixtureTimestamp;
        },
        version: { min: "0.1", max: "0.1" },
    });
    const referenceCancelRuntime = new refEnvelope.EnvelopeRuntime({
        now: (): string => {
            return FixtureTimestamp;
        },
        version: { min: "0.1", max: "0.1" },
    });
    const vendorCancel: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.cancel", "thread.2", 0, "cancel", {
        targetId: "m.cancel-target",
        reason: "superseded",
    });
    const referenceCancel: SealedEnvelope = await sealForRuntime(refEnvelope, "m.cancel", "thread.2", 0, "cancel", {
        targetId: "m.cancel-target",
        reason: "superseded",
    });
    const vendorTarget: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.cancel-target", "thread.2", 1, "inform", {
        order: 1,
    });
    const referenceTarget: SealedEnvelope = await sealForRuntime(refEnvelope, "m.cancel-target", "thread.2", 1, "inform", {
        order: 1,
    });
    const vendorAfter: SealedEnvelope = await sealForRuntime(vendorEnvelope, "m.after", "thread.2", 2, "inform", {
        order: 2,
    });
    const referenceAfter: SealedEnvelope = await sealForRuntime(refEnvelope, "m.after", "thread.2", 2, "inform", {
        order: 2,
    });
    const vendorCancelStatuses: string[] = [];
    const referenceCancelStatuses: string[] = [];
    const cancelPair: { vendor: SealedEnvelope; reference: SealedEnvelope }[] = [
        { vendor: vendorCancel, reference: referenceCancel },
        { vendor: vendorTarget, reference: referenceTarget },
        { vendor: vendorAfter, reference: referenceAfter },
    ];
    for (let index: number = 0; index < cancelPair.length; index += 1) {
        const pair: { vendor: SealedEnvelope; reference: SealedEnvelope } = cancelPair[index];
        const vendorVerdict = await vendorCancelRuntime.receive(pair.vendor, FixedPublicKey);
        const referenceVerdict = await referenceCancelRuntime.receive(pair.reference, FixedPublicKey);
        vendorCancelStatuses.push(`${vendorVerdict.status}:${vendorVerdict.reasons.join("|")}`);
        referenceCancelStatuses.push(`${referenceVerdict.status}:${referenceVerdict.reasons.join("|")}`);
    }
    compare("protocol/runtime-cancel-status", vendorCancelStatuses, referenceCancelStatuses, "thread.2");
    compare("protocol/runtime-cancelled", deliveredIds(vendorCancelRuntime.cancelled), deliveredIds(referenceCancelRuntime.cancelled), "thread.2");

    const delegation: Delegation = {
        id: "dl.1",
        parent: "dl.0",
        granter: "agent.calendar",
        delegatee: "agent.worker",
        goalDigest: DigestA,
        scope: ["files.read", "files.write"],
        budget: { tokens: 5000, calls: 10, ms: 30000 },
        deadline: "2026-11-01T00:00:00.000Z",
        mayRedelegate: false,
        depth: 1,
    };
    compare("protocol/wire-delegation-doc", vendorWire.toDelegationDoc(delegation), refWire.toDelegationDoc(delegation), delegation);
    compare(
        "protocol/wire-delegation-roundtrip",
        vendorWire.fromDelegationDoc(vendorWire.toDelegationDoc(delegation)),
        refWire.fromDelegationDoc(refWire.toDelegationDoc(delegation)),
        delegation,
    );

    const delegationWithoutParent: Delegation = {
        id: "dl.2",
        granter: "agent.calendar",
        delegatee: "agent.worker",
        goalDigest: DigestB,
        scope: ["files.read"],
        budget: { tokens: 100 },
        deadline: "2026-11-02T00:00:00.000Z",
        mayRedelegate: true,
        depth: 0,
    };
    compare(
        "protocol/wire-delegation-no-parent",
        vendorWire.fromDelegationDoc(vendorWire.toDelegationDoc(delegationWithoutParent)),
        refWire.fromDelegationDoc(refWire.toDelegationDoc(delegationWithoutParent)),
        delegationWithoutParent,
    );

    const lease: Lease = {
        id: "ls.1",
        delegation: "dl.1",
        taskId: "task.import",
        holder: "agent.worker",
        fence: 3,
        goalDigest: DigestA,
        budget: { tokens: 2000, calls: 4, ms: 10000 },
        deadline: "2026-10-31T00:00:00.000Z",
        status: "active",
    };
    compare("protocol/wire-lease-doc", vendorWire.toLeaseDoc(lease), refWire.toLeaseDoc(lease), lease);

    const serialized: string = JSON.stringify(vendorSealed);
    const parsed: SealedEnvelope = JSON.parse(serialized) as SealedEnvelope;
    const reserialized: string = JSON.stringify(parsed);
    const canonicalRoundtrip: boolean =
        serialized === reserialized &&
        vendorSemantics.canonical(parsed) === vendorSemantics.canonical(vendorSealed) &&
        refSemantics.canonical(parsed) === refSemantics.canonical(referenceSealed);
    record("protocol/envelope-json-roundtrip", canonicalRoundtrip, `bytes=${String(serialized.length)}`);
}

interface ParityReport {
    ok: boolean;
    referenceLib: string;
    vendorRoot: string;
    total: number;
    passed: number;
    failed: number;
    cases: CaseResult[];
}

const emitHumanSummary = (): number => {
    const failed: CaseResult[] = results.filter((item) => {
        return !item.ok;
    });
    console.error("");
    console.error(`AMP parity: ${String(results.length - failed.length)}/${String(results.length)} passed, ${String(failed.length)} failed`);
    if (failed.length > 0) {
        console.error("failures:");
        for (let index: number = 0; index < failed.length; index += 1) {
            const failure: CaseResult = failed[index];
            console.error(`  - ${failure.case}: ${failure.detail}`);
        }
    }
    return failed.length;
};

async function main(): Promise<void> {
    await runCanonical();
    await runSha256();
    await runManifest();
    await runBayes();
    await runWarrant();
    await runCalibrationAndReliability();
    await runAttention();
    await runLedger();
    await runReceiptAndHandles();
    await runBoundaryAndPolicy();
    await runProtocolAndWire();

    const failedCount: number = emitHumanSummary();
    const report: ParityReport = {
        ok: failedCount === 0,
        referenceLib: ReferenceLib,
        vendorRoot: VendorRoot,
        total: results.length,
        passed: results.length - failedCount,
        failed: failedCount,
        cases: results,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = failedCount === 0 ? 0 : 1;
}

await main();

