"""
model/validate_argo.py

Real validation run: OceanEmbed model vs 6 INCOIS/Coriolis ARGO benchmark floats.

For each float it feeds the float's own surface telemetry through the
TRAINED model (model/infer.py + oceanembed_final.keras) and scores the
predicted profile against the float's true in-situ readings, then writes
model/metrics.json in the backend contract format (see MODEL_INTEGRATION.md).

Input mapping (documented so anyone can reproduce bit-identical numbers):
  sst, sss                    -> direct
  sla                         -> ssh_or_sla
  ugos, vgos                  -> current_u, current_v
  wind_speed_ms (scalar only;  -> wind_u (ARGO telemetry carries no wind
  ARGO has no wind direction)     direction, so the full speed is applied
                                  zonally and wind_v = 0.0)

Usage:
    python model/validate_argo.py
"""

import json
import math
import sys
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent
FLOATS_FILE = MODEL_DIR / "argo_benchmark_floats.json"
METRICS_FILE = MODEL_DIR / "metrics.json"

sys.path.insert(0, str(MODEL_DIR))
import infer  # noqa: E402  (model/infer.py — the trained inference entry point)


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 1.0
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return 1.0
    return max(-1.0, min(1.0, cov / math.sqrt(vx * vy)))


def main() -> None:
    floats = json.loads(FLOATS_FILE.read_text(encoding="utf-8"))["floats"]

    all_pred: list[float] = []
    all_true: list[float] = []
    all_err: list[float] = []
    per_depth: dict[int, dict[str, list[float]]] = {}

    for fl in floats:
        tele = fl["surface_telemetry"]
        surface = {
            "sst": tele["sst"],
            "sss": tele["sss"],
            "ssh_or_sla": tele["sla"],
            "current_u": tele["ugos"],
            "current_v": tele["vgos"],
            "wind_u": tele["wind_speed_ms"],
            "wind_v": 0.0,
        }
        depths = [p["depth_m"] for p in fl["profile"]]
        preds = {int(p["depth_m"]): float(p["temperature_c"]) for p in infer.predict(
            latitude=float(fl["latitude"]),
            longitude=float(fl["longitude"]),
            date=str(fl["date"]),
            depths=[int(d) for d in depths],
            surface=surface,
        )}
        for rec in fl["profile"]:
            d = int(rec["depth_m"])
            t_true = float(rec["true_argo_reading_c"])
            t_pred = preds[d]
            err = t_pred - t_true
            all_pred.append(t_pred)
            all_true.append(t_true)
            all_err.append(err)
            per_depth.setdefault(d, {"pred": [], "true": [], "err": []})
            per_depth[d]["pred"].append(t_pred)
            per_depth[d]["true"].append(t_true)
            per_depth[d]["err"].append(err)
        print(f"float {fl['float_id']} ({fl['region']}): surface ok, {len(depths)} depths scored")

    n = len(all_err)
    rmse = math.sqrt(sum(e * e for e in all_err) / n)
    bias = sum(all_err) / n
    corr = pearson(all_pred, all_true)

    per_depth_out = []
    for d in sorted(per_depth):
        bucket = per_depth[d]
        m = len(bucket["err"])
        per_depth_out.append({
            "depth_m": d,
            "rmse_c": round(math.sqrt(sum(e * e for e in bucket["err"]) / m), 3),
            "correlation": round(pearson(bucket["pred"], bucket["true"]), 4),
            "bias_c": round(sum(bucket["err"]) / m, 3),
            "n": m,
        })

    metrics = {
        "model": {"name": getattr(infer, "MODEL_NAME", "OceanEmbed")},
        "overall": {
            "rmse_c": round(rmse, 3),
            "correlation": round(corr, 4),
            "bias_c": round(bias, 3),
            "n_profiles": len(floats),
            "n_pairs": n,
        },
        "per_depth": per_depth_out,
        "validation": {
            "dataset": "6 INCOIS/Coriolis ARGO benchmark floats vs trained-model rerun",
            "period": "float dates span 2024-2025 (per-float date in argo_benchmark_floats.json)",
            "region": "5N-30N, 45E-105E (North Indian Ocean)",
            "method": "model/validate_argo.py: each float's surface telemetry through "
                      "model/infer.py, scored against its in-situ profile; "
                      "wind_speed_ms applied zonally (no ARGO wind direction)",
        },
    }
    METRICS_FILE.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"\nOVERALL rmse={rmse:.3f} C  bias={bias:+.3f} C  r={corr:.4f}  n={n} pairs / "
          f"{len(floats)} floats")
    print(f"wrote {METRICS_FILE}")


if __name__ == "__main__":
    main()
