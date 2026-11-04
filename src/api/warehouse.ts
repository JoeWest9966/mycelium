// Warehouse (Nous) machine catalog.
//
// This is NOT part of hypha's OpenAPI contract. It is a second, external
// contract — schema `vq0f03/vps-ls.v1` — served by the Nous deployment, whose
// own upstream is nw-panel (`nw/vps-ls.v1`) reading /opt/Data-001/vps/vps.json.
//
// The panel does not hardcode that address. It asks for one path,
// `/api/warehouse/vps`, and whoever deploys decides what answers it:
//
//   dev:  vite.config.ts proxies /api/warehouse -> the Nous deployment
//   prod: an nginx location does the same (see hypha/dist/nginx-hypha.conf)
//   later: hyphad can serve it itself and nothing here changes
//
// Shapes below mirror the payload as observed, with the caveat that an
// external contract can drift without our build noticing. Everything is
// therefore optional-but-checked at the point of use.

export type WarehouseIp = {
  label: string
  addr: string
}

export type WarehouseSsh = {
  label: string
  addr: string
  /** Ready-to-paste command, e.g. `ssh -p 9551 root@100.106.43.81`. */
  cmd: string
}

export type WarehouseFact = {
  k: string
  v: string
}

export type WarehouseMachine = {
  name: string
  note?: string
  user?: string
  port?: number
  ips?: WarehouseIp[]
  ssh?: WarehouseSsh[]
  tags?: string[]
  role?: string
  facts?: WarehouseFact[]
  /** Annotations added by the warehouse side, not by this panel. */
  annotated?: boolean
}

export type WarehouseSource = {
  project?: string
  panel?: string
  catalog?: string
  schema?: string
  auth?: string
}

export type WarehouseUpstream = {
  base?: string
  ok?: boolean
  status?: number
  ms?: number
  nw?: string
}

export type WarehousePayload = {
  schema: string
  ok: boolean
  errors?: unknown[]
  warnings?: unknown[]
  at?: string
  data: {
    source?: WarehouseSource
    upstream?: WarehouseUpstream
    machines?: WarehouseMachine[]
  }
}

/** Where the panel expects a warehouse proxy to answer. */
export const WAREHOUSE_VPS_PATH = '/api/warehouse/vps'

export class WarehouseError extends Error {}

export async function fetchWarehouse(): Promise<WarehousePayload> {
  let res: Response
  try {
    res = await fetch(WAREHOUSE_VPS_PATH, { headers: { accept: 'application/json' } })
  } catch (err) {
    throw new WarehouseError(
      `no warehouse proxy at ${WAREHOUSE_VPS_PATH} (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const text = await res.text()
  if (res.status === 404) {
    throw new WarehouseError(
      `nothing answers ${WAREHOUSE_VPS_PATH}. Point your dev proxy or nginx at the Nous deployment.`,
    )
  }
  if (!res.ok) {
    throw new WarehouseError(`warehouse returned ${res.status}: ${text.slice(0, 200)}`)
  }

  let payload: WarehousePayload
  try {
    payload = JSON.parse(text) as WarehousePayload
  } catch {
    // A proxy that forwards to the wrong upstream typically answers with HTML.
    throw new WarehouseError(
      `${WAREHOUSE_VPS_PATH} did not return JSON — is the proxy pointing at the Nous API and not at the panel's own index?`,
    )
  }

  if (!payload.ok) {
    throw new WarehouseError('warehouse reported failure for the vps catalog')
  }
  return payload
}
