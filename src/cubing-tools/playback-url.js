const ALG_CUBING_BASE_URL = "https://alg.cubing.net/";

export function buildAlgCubingNetUrl({ setup = "", alg, view = "playback" }) {
  if (!alg || !alg.trim()) {
    throw new Error("alg 不能为空");
  }

  const params = new URLSearchParams();
  if (setup && setup.trim()) {
    params.set("setup", encodeAlgParam(setup));
  }
  params.set("alg", encodeAlgParam(alg));
  params.set("view", view);

  return `${ALG_CUBING_BASE_URL}?${params.toString()}`;
}

export function buildPlaybackBBCode({ setup = "", alg, label }) {
  const url = buildAlgCubingNetUrl({ setup, alg });
  const text = label || alg;
  return `[URL="${url}"]${text}[/URL]`;
}

function encodeAlgParam(value) {
  return value.trim().replace(/'/g, "-").replace(/\s+/g, "_");
}
