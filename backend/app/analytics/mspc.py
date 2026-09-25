"""Multivariate Statistical Process Control: PCA model with Hotelling T² and SPE (Q) statistics.

The model is trained on NORMAL operating data only. No failure examples are needed: it learns
what healthy operation looks like, then flags samples that sit far from that pattern (T²) or that
break the relationships between tags (SPE).
"""
from __future__ import annotations

import numpy as np


class MSPCModel:
    def __init__(self, n_train: int, keys: list[str]):
        self.n_train = n_train
        self.keys = keys
        self.buf: list[np.ndarray] = []
        self.ready = False
        self.trained_range: tuple[int, int] | None = None
        self.info: dict = {}

    @property
    def progress(self) -> float:
        return 1.0 if self.ready else len(self.buf) / self.n_train

    def add(self, h: int, x: np.ndarray) -> bool:
        """Collect a clean training sample; returns True when the model has just been fitted."""
        if self.ready:
            return False
        if not self.buf:
            self._first_h = h
        self.buf.append(x.astype(float))
        if len(self.buf) >= self.n_train:
            self.fit(np.vstack(self.buf), (self._first_h, h))
            return True
        return False

    def fit(self, X: np.ndarray, h_range: tuple[int, int]) -> None:
        n, p = X.shape
        self.mu = X.mean(0)
        self.sd = X.std(0, ddof=1)
        self.sd[self.sd < 1e-9] = 1e-9
        Z = (X - self.mu) / self.sd
        _, S, Vt = np.linalg.svd(Z, full_matrices=False)
        var = S ** 2 / (n - 1)
        cum = np.cumsum(var) / var.sum()
        k = int(np.searchsorted(cum, 0.90) + 1)
        k = max(1, min(k, p - 1))           # keep at least one residual direction so SPE exists
        self.P = Vt[:k].T
        self.lam = var[:k]
        T = Z @ self.P
        t2 = (T ** 2 / self.lam).sum(1)
        spe = ((Z - T @ self.P.T) ** 2).sum(1)
        self.lim_t2 = float(max(np.percentile(t2, 99.9), 1e-6))
        self.lim_spe = float(max(np.percentile(spe, 99.9), 1e-6))
        self.ready = True
        self.buf = []
        self.trained_range = h_range
        self.info = {"n": int(n), "k": k, "p": int(p), "explained": float(cum[k - 1]),
                     "limT2": self.lim_t2, "limSPE": self.lim_spe}

    def score(self, x: np.ndarray) -> dict:
        z = (x - self.mu) / self.sd
        t = z @ self.P
        t2 = float(np.sum(t * t / self.lam))
        r = z - t @ self.P.T
        spe = float(np.sum(r * r))
        r_t2, r_spe = t2 / self.lim_t2, spe / self.lim_spe
        return {"t2": t2, "spe": spe, "ratio": max(r_t2, r_spe), "stat": "SPE" if r_spe >= r_t2 else "T2", "z": z, "t": t, "r": r}

    def contributions(self, sc: dict) -> np.ndarray:
        """Share of the violating statistic explained by each variable (sums to 1)."""
        if sc["stat"] == "SPE":
            c = sc["r"] ** 2
        else:
            c = np.clip(sc["z"] * (self.P @ (sc["t"] / self.lam)), 0, None)
        return c / max(float(c.sum()), 1e-12)
