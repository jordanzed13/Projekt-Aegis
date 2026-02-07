import fs from "node:fs";
import path from "node:path";

export type AlertCounts = {
  green: number;
  yellow: number;
  red: number;
  error: number;
};

type MetricsStore = {
  version: 1;
  totals: AlertCounts;
  updatedAt: string;
};

const emptyCounts = (): AlertCounts => ({
  green: 0,
  yellow: 0,
  red: 0,
  error: 0,
});

export class AlertMetrics {
  private readonly metricsPath: string;
  private readonly sessionCounts: AlertCounts;
  private lifetimeCounts: AlertCounts;
  private lastWriteMs = 0;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(metricsPath: string) {
    this.metricsPath = metricsPath;
    this.sessionCounts = emptyCounts();
    this.lifetimeCounts = emptyCounts();
    this.loadLifetime();
  }

  private loadLifetime() {
    try {
      const raw = fs.readFileSync(this.metricsPath, "utf8");
      const parsed = JSON.parse(raw) as MetricsStore;
      if (parsed?.version === 1 && parsed.totals) {
        this.lifetimeCounts = {
          green: Number(parsed.totals.green ?? 0),
          yellow: Number(parsed.totals.yellow ?? 0),
          red: Number(parsed.totals.red ?? 0),
          error: Number(parsed.totals.error ?? 0),
        };
      }
    } catch {
      this.lifetimeCounts = emptyCounts();
    }
  }

  private scheduleWrite() {
    if (this.writeTimer) {
      return;
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistLifetime();
    }, 2000);
  }

  private persistLifetime() {
    const now = Date.now();
    if (now - this.lastWriteMs < 500) {
      return;
    }
    const payload: MetricsStore = {
      version: 1,
      totals: this.lifetimeCounts,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.metricsPath), { recursive: true });
    fs.writeFileSync(this.metricsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    this.lastWriteMs = now;
  }

  bump(level: "GREEN" | "YELLOW" | "RED") {
    if (level === "GREEN") {
      this.sessionCounts.green += 1;
      this.lifetimeCounts.green += 1;
    } else if (level === "YELLOW") {
      this.sessionCounts.yellow += 1;
      this.lifetimeCounts.yellow += 1;
    } else {
      this.sessionCounts.red += 1;
      this.lifetimeCounts.red += 1;
    }
    this.scheduleWrite();
  }

  bumpError() {
    this.sessionCounts.error += 1;
    this.lifetimeCounts.error += 1;
    this.scheduleWrite();
  }

  snapshot() {
    return {
      session: { ...this.sessionCounts },
      lifetime: { ...this.lifetimeCounts },
    };
  }
}
