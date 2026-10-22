import type {
    AmpBelief,
    AmpBeliefTrace,
    AmpBetaPosterior,
    AmpBetaPrior,
    AmpCalibrationSample,
    AmpDependence,
    AmpEvidence,
    AmpLikelihood,
    AmpLikelihoodContribution,
} from "./types";

const MIN_PROBABILITY: number = 0.000001;
const MAX_PROBABILITY: number = 0.999999;
const DEFAULT_RHO: number = 0.2;
const MAX_RHO: number = 0.8;

export interface AmpEvidenceCluster {
    id: string;
    evidence: AmpEvidence[];
}

function clampProbability(probability: number): number {
    return Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY, probability));
}

export function logit(probability: number): number {
    const clamped: number = clampProbability(probability);
    return Math.log(clamped / (1 - clamped));
}

export function sigmoid(logOdds: number): number {
    if (logOdds >= 0) {
        const expNeg: number = Math.exp(-logOdds);
        return 1 / (1 + expNeg);
    }
    const expPos: number = Math.exp(logOdds);
    return expPos / (1 + expPos);
}

export function makeBinaryLikelihood(sensitivity: number, falsePositiveRate: number): AmpLikelihood {
    const se: number = clampProbability(sensitivity);
    const fp: number = clampProbability(falsePositiveRate);
    return {
        model: "binary",
        sensitivity: se,
        false_positive_rate: fp,
        lr_plus: se / fp,
        lr_minus: (1 - se) / (1 - fp),
    };
}

export function makeNormalLikelihood(
    muTrue: number,
    sigmaTrue: number,
    muFalse: number,
    sigmaFalse: number,
): AmpLikelihood {
    return {
        model: "normal",
        mu_true: muTrue,
        sigma_true: Math.max(MIN_PROBABILITY, sigmaTrue),
        mu_false: muFalse,
        sigma_false: Math.max(MIN_PROBABILITY, sigmaFalse),
    };
}

export function makeBetaLikelihood(alpha: number, beta: number): AmpLikelihood {
    return {
        model: "beta-binomial",
        alpha: Math.max(MIN_PROBABILITY, alpha),
        beta: Math.max(MIN_PROBABILITY, beta),
    };
}

function normalPdf(value: number, mean: number, sigma: number): number {
    const safeSigma: number = Math.max(MIN_PROBABILITY, sigma);
    const z: number = (value - mean) / safeSigma;
    return Math.exp(-0.5 * z * z) / (safeSigma * Math.sqrt(2 * Math.PI));
}

function normalLogLikelihood(likelihood: AmpLikelihood, value: number | undefined): number {
    if (likelihood.model !== "normal" || value === (void 0)) {
        return 0;
    }
    const trueDensity: number = normalPdf(value, likelihood.mu_true, likelihood.sigma_true);
    const falseDensity: number = normalPdf(value, likelihood.mu_false, likelihood.sigma_false);
    return Math.log(Math.max(trueDensity, Number.EPSILON) / Math.max(falseDensity, Number.EPSILON));
}

export function evidenceLogLikelihood(evidence: AmpEvidence): number {
    if (evidence.calibration === (void 0)) {
        return 0;
    }
    if (evidence.likelihood.model === "binary") {
        if (evidence.outcome === (void 0)) {
            return 0;
        }
        const lr: number = evidence.outcome === "positive"
            ? evidence.likelihood.lr_plus
            : evidence.likelihood.lr_minus;
        return Math.log(Math.max(lr, Number.EPSILON));
    }
    if (evidence.likelihood.model === "normal") {
        return normalLogLikelihood(evidence.likelihood, evidence.value);
    }
    return 0;
}

function findRoot(parent: Map<string, string>, id: string): string {
    const current: string = parent.get(id) ?? id;
    if (current === id) {
        return id;
    }
    const root: string = findRoot(parent, current);
    parent.set(id, root);
    return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
    const leftRoot: string = findRoot(parent, left);
    const rightRoot: string = findRoot(parent, right);
    if (leftRoot !== rightRoot) {
        parent.set(rightRoot, leftRoot);
    }
}

export function clusterEvidence(evidence: readonly AmpEvidence[]): AmpEvidenceCluster[] {
    const parent: Map<string, string> = new Map<string, string>();
    for (const item of evidence) {
        parent.set(item.id, item.id);
        for (const dependency of item.depends_on) {
            parent.set(dependency, dependency);
            union(parent, item.id, dependency);
        }
    }
    const clusters: Map<string, AmpEvidence[]> = new Map<string, AmpEvidence[]>();
    for (const item of evidence) {
        const root: string = item.cluster ?? findRoot(parent, item.id);
        const bucket: AmpEvidence[] = clusters.get(root) ?? [];
        bucket.push(item);
        clusters.set(root, bucket);
    }
    return [...clusters.entries()].map((entry: [string, AmpEvidence[]]): AmpEvidenceCluster => {
        const id: string = entry[0];
        const items: AmpEvidence[] = entry[1];
        return { id, evidence: items };
    });
}

export function updateBelief(
    prior: number,
    priorSource: string,
    evidence: readonly AmpEvidence[],
    dependence?: Partial<AmpDependence>,
): AmpBelief {
    const priorClamped: number = clampProbability(prior);
    const rho: number = Math.min(MAX_RHO, Math.max(0, dependence?.rho ?? DEFAULT_RHO));
    const clusters: AmpEvidenceCluster[] = clusterEvidence(evidence);
    const contributions: AmpLikelihoodContribution[] = [];
    let effectiveLogOdds: number = logit(priorClamped);

    for (const cluster of clusters) {
        const clusterLogLr: number = cluster.evidence.reduce((sum: number, item: AmpEvidence): number => {
            return sum + evidenceLogLikelihood(item) * (item.weight ?? 1);
        }, 0);
        const divisor: number = 1 + rho * (cluster.evidence.length - 1);
        const effectiveClusterLogLr: number = clusterLogLr / divisor;
        effectiveLogOdds += effectiveClusterLogLr;
        for (const item of cluster.evidence) {
            const logLr: number = evidenceLogLikelihood(item);
            const weight: number = item.weight ?? 1;
            contributions.push({
                evidence_id: item.id,
                cluster: cluster.id,
                weight,
                log_lr: logLr,
                effective_log_lr: (logLr * weight) / divisor,
            });
        }
    }

    const posterior: number = sigmoid(effectiveLogOdds);
    const lowPrior: number = clampProbability(priorClamped - 0.1);
    const highPrior: number = clampProbability(priorClamped + 0.1);
    const lowPosterior: number = sigmoid(logit(lowPrior) + effectiveLogOdds - logit(priorClamped));
    const highPosterior: number = sigmoid(logit(highPrior) + effectiveLogOdds - logit(priorClamped));
    const trace: AmpBeliefTrace = {
        prior_log_odds: logit(priorClamped),
        contributions,
        effective_log_odds: effectiveLogOdds,
        posterior,
        prior_sensitivity: {
            low: lowPosterior,
            high: highPosterior,
            flips: (lowPosterior - 0.5) * (highPosterior - 0.5) < 0,
        },
    };

    return {
        prior: priorClamped,
        prior_source: priorSource,
        evidence: evidence.map((item: AmpEvidence): string => {
            return item.id;
        }),
        log_odds: effectiveLogOdds,
        posterior,
        model: "amp-bayes/1",
        dependence: {
            rho,
            clusters: clusters.length,
            model: "amp-dependence/1",
        },
        trace,
    };
}

export function updateBeta(
    prior: AmpBetaPrior,
    successes: number,
    failures: number,
): AmpBetaPosterior {
    const mu: number = clampProbability(prior.mu);
    const kappa: number = Math.max(MIN_PROBABILITY, prior.kappa);
    const alpha: number = mu * kappa + Math.max(0, successes);
    const beta: number = (1 - mu) * kappa + Math.max(0, failures);
    const total: number = alpha + beta;
    const mean: number = alpha / total;
    const variance: number = (alpha * beta) / (total * total * (total + 1));
    const sd: number = Math.sqrt(variance);
    return {
        alpha,
        beta,
        mean,
        sd,
        n: Math.max(0, successes) + Math.max(0, failures),
        credible_interval: [
            Math.max(0, mean - 1.96 * sd),
            Math.min(1, mean + 1.96 * sd),
        ],
    };
}

export function brierScore(samples: readonly AmpCalibrationSample[]): number | null {
    if (samples.length === 0) {
        return null;
    }
    const total: number = samples.reduce((sum: number, sample: AmpCalibrationSample): number => {
        const delta: number = sample.probability - sample.outcome;
        return sum + delta * delta;
    }, 0);
    return total / samples.length;
}

export function expectedCalibrationError(samples: readonly AmpCalibrationSample[], bins: number = 10): number | null {
    if (samples.length === 0) {
        return null;
    }
    const bucketCount: number = Math.max(1, Math.floor(bins));
    const buckets: Array<{ probability: number; outcome: number; count: number }> = Array.from(
        { length: bucketCount },
        (): { probability: number; outcome: number; count: number } => {
            return { probability: 0, outcome: 0, count: 0 };
        },
    );
    for (const sample of samples) {
        const index: number = Math.min(bucketCount - 1, Math.floor(sample.probability * bucketCount));
        const bucket: { probability: number; outcome: number; count: number } = buckets[index];
        bucket.probability += sample.probability;
        bucket.outcome += sample.outcome;
        bucket.count += 1;
    }
    const ece: number = buckets.reduce((sum: number, bucket: { probability: number; outcome: number; count: number }): number => {
        if (bucket.count === 0) {
            return sum;
        }
        const avgProbability: number = bucket.probability / bucket.count;
        const avgOutcome: number = bucket.outcome / bucket.count;
        return sum + (bucket.count / samples.length) * Math.abs(avgProbability - avgOutcome);
    }, 0);
    return ece;
}

export function logLoss(samples: readonly AmpCalibrationSample[]): number | null {
    if (samples.length === 0) {
        return null;
    }
    const total: number = samples.reduce((sum: number, sample: AmpCalibrationSample): number => {
        const probability: number = sample.outcome === 1
            ? sample.probability
            : 1 - sample.probability;
        return sum - Math.log(Math.max(MIN_PROBABILITY, probability));
    }, 0);
    return total / samples.length;
}
