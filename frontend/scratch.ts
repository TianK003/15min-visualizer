
export async function obcinaGeom(naziv: string) {
  const res = await fetch(
    `${url}/rest/v1/obcine?naziv=eq.${encodeURIComponent(naziv)}&select=geom`,
    {
      headers: {
        apikey: anon!,
        Authorization: `Bearer ${anon}`,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) throw new Error(`obcine geom ${res.status}`);
  const data = await res.json();
  return data.length > 0 ? data[0].geom : null;
}

export type LlmSearchRow = {
  h3: string;
  score: number;
  population: number;
};

export async function llmSearchCells(filterSpec: any, limit: number = 5) {
  const res = await fetch(`${url}/rest/v1/rpc/llm_search_cells`, {
    method: "POST",
    headers: {
      apikey: anon!,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filter_spec: filterSpec, p_limit: limit }),
  });
  if (!res.ok) throw new Error(`RPC llm_search_cells ${res.status} ${await res.text()}`);
  return (await res.json()) as LlmSearchRow[];
}
