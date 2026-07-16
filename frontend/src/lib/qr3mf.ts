import qrcode from 'qrcode-generator'
import { strToU8, zipSync } from 'fflate'

/**
 * Generates a two-part 3MF model of a QR code for two-color 3D printing.
 *
 * The file contains two separate mesh objects sharing one coordinate space:
 *  - "Base plate": a square slab (plus an optional lanyard-loop tab)
 *  - "QR code": the dark modules, raised as a thin relief on top of the plate
 *
 * Slicers (PrusaSlicer, Bambu Studio, Cura, ...) import these as separate
 * parts of one model, so each can be assigned its own filament — or printed
 * on a single-extruder machine with a filament swap at the relief height.
 */

export interface Qr3mfOptions {
  /** Width/height of the square base plate, in millimeters. */
  sizeMm: number
  /** Thickness of the base plate, in millimeters. */
  thicknessMm: number
  /** Add a pill-shaped tab above the plate with a standard badge slot. */
  lanyardLoop: boolean
  /** Blank border around the code, in component widths. */
  quietZoneComponents: number
  /** Height of the raised QR relief above the plate, in millimeters. */
  reliefMm: number
}

export const QR3MF_LIMITS = {
  /**
   * Minimum printable component pitch. Below ~1.2mm an 0.4mm FDM nozzle
   * can't render component edges cleanly and phone cameras struggle to
   * resolve the code, so the overall size slider is clamped to keep
   * components above this.
   */
  minModuleMm: 1.2,
  maxSizeMm: 120,
  minThicknessMm: 1.2,
  maxThicknessMm: 6,
  /**
   * The QR spec asks for a 4-component quiet zone; it scans reliably in
   * practice down to 1. Below that, cameras can't reliably separate the
   * code from surrounding print bed / lanyard clutter.
   */
  minQuietZoneComponents: 1,
  maxQuietZoneComponents: 4,
  minReliefMm: 0.2,
  maxReliefMm: 1.5,
} as const

/** Default blank border around the code, in component widths. */
export const DEFAULT_QUIET_ZONE_COMPONENTS = 1.5

/** Default height of the raised QR relief above the plate (3 layers at 0.2mm). */
export const DEFAULT_RELIEF_MM = 0.6

/**
 * Lanyard slot: 14 x 3 mm is the standard ID-badge slot-punch size, so the
 * printed tag fits stock lanyard clips and badge reels.
 */
const SLOT_LENGTH_MM = 14
const SLOT_WIDTH_MM = 3
/** Material ring around the slot. */
const TAB_WALL_MM = 3
/** How far the tab sinks into the plate so the two fuse when sliced. */
const TAB_OVERLAP_MM = 2
/** Segments per semicircular cap of the pill outlines. */
const CAP_SEGMENTS = 16

/**
 * Error correction level for the printed code. The on-screen QR uses 'H' so
 * a profile photo can overlay the center; the printed tag has no overlay,
 * and 'M' yields fewer modules — each module prints larger and scans better
 * at the same physical size.
 */
const EC_LEVEL = 'M'

function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, EC_LEVEL)
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const rows: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) {
      row.push(qr.isDark(r, c))
    }
    rows.push(row)
  }
  return rows
}

/** Number of modules per side for the code that `text` encodes. */
export function computeModuleCount(text: string): number {
  const qr = qrcode(0, EC_LEVEL)
  qr.addData(text)
  qr.make()
  return qr.getModuleCount()
}

/**
 * Smallest plate size (mm) at which every component stays at or above the
 * printable/scannable minimum pitch, including the quiet zone.
 */
export function computeMinSizeMm(
  text: string,
  quietZoneComponents: number = DEFAULT_QUIET_ZONE_COMPONENTS,
): number {
  const modules = computeModuleCount(text) + 2 * quietZoneComponents
  return Math.ceil(modules * QR3MF_LIMITS.minModuleMm)
}

/** Simple indexed triangle mesh; vertices and triangles are flat arrays. */
export interface Mesh {
  vertices: number[]
  triangles: number[]
}

function addQuad(mesh: Mesh, a: number, b: number, c: number, d: number) {
  mesh.triangles.push(a, b, c, a, c, d)
}

/** Axis-aligned box with outward-facing (CCW from outside) triangles. */
function addBox(
  mesh: Mesh,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  const base = mesh.vertices.length / 3
  mesh.vertices.push(
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  )
  addQuad(mesh, base + 0, base + 3, base + 2, base + 1) // bottom (-z)
  addQuad(mesh, base + 4, base + 5, base + 6, base + 7) // top (+z)
  addQuad(mesh, base + 0, base + 1, base + 5, base + 4) // front (-y)
  addQuad(mesh, base + 1, base + 2, base + 6, base + 5) // right (+x)
  addQuad(mesh, base + 2, base + 3, base + 7, base + 6) // back (+y)
  addQuad(mesh, base + 3, base + 0, base + 4, base + 7) // left (-x)
}

type Point = readonly [number, number]

/**
 * CCW outline of a stadium (pill) shape: a `length` x `width` rectangle with
 * semicircular caps. Starts at the bottom of the right cap.
 */
function stadiumOutline(
  cx: number,
  cy: number,
  length: number,
  width: number,
): Point[] {
  const r = width / 2
  const half = (length - width) / 2
  const points: Point[] = []
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / CAP_SEGMENTS
    points.push([cx + half + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / CAP_SEGMENTS
    points.push([cx - half + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return points
}

/**
 * Extrudes the ring between two concentric CCW outlines (a solid with a
 * hole) from z0 to z1. Outlines must have the same point count with
 * corresponding indices — true for two stadiums offset by a constant wall,
 * which is how the lanyard tab is built.
 */
function addRingExtrusion(
  mesh: Mesh,
  outer: Point[],
  inner: Point[],
  z0: number,
  z1: number,
) {
  const n = outer.length
  const base = mesh.vertices.length / 3
  for (const [x, y] of outer) mesh.vertices.push(x, y, z0)
  for (const [x, y] of inner) mesh.vertices.push(x, y, z0)
  for (const [x, y] of outer) mesh.vertices.push(x, y, z1)
  for (const [x, y] of inner) mesh.vertices.push(x, y, z1)

  const ob = base
  const ib = base + n
  const ot = base + 2 * n
  const it = base + 3 * n
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    addQuad(mesh, ot + i, ot + j, it + j, it + i) // top ring (+z)
    addQuad(mesh, ob + i, ib + i, ib + j, ob + j) // bottom ring (-z)
    addQuad(mesh, ob + i, ob + j, ot + j, ot + i) // outer wall
    addQuad(mesh, ib + j, ib + i, it + i, it + j) // slot wall (faces hole)
  }
}

/** Millimeter values rounded to 1µm so XML stays free of float noise. */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

function meshXml(mesh: Mesh): string {
  const verts: string[] = []
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    verts.push(
      `<vertex x="${fmt(mesh.vertices[i])}" y="${fmt(mesh.vertices[i + 1])}" z="${fmt(mesh.vertices[i + 2])}" />`,
    )
  }
  const tris: string[] = []
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    tris.push(
      `<triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}" />`,
    )
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`
}

/**
 * Builds the two meshes that make up the model — the base plate (with
 * optional lanyard tab) and the raised QR relief — in a shared coordinate
 * space. Used by the .3mf exporter and by the on-screen preview, so what
 * the preview shows is exactly what the slicer will import. Does not
 * validate ranges; generateQr3mf does that before packaging.
 */
export function buildQr3mfMeshes(
  text: string,
  options: Qr3mfOptions,
): { base: Mesh; qr: Mesh } {
  const { sizeMm, thicknessMm, lanyardLoop, quietZoneComponents, reliefMm } = options

  const matrix = qrMatrix(text)
  const n = matrix.length
  const pitch = sizeMm / (n + 2 * quietZoneComponents)
  const margin = quietZoneComponents * pitch

  const baseMesh: Mesh = { vertices: [], triangles: [] }
  addBox(baseMesh, 0, 0, 0, sizeMm, sizeMm, thicknessMm)

  if (lanyardLoop) {
    const tabWidth = SLOT_WIDTH_MM + 2 * TAB_WALL_MM
    const tabLength = SLOT_LENGTH_MM + 2 * TAB_WALL_MM
    // Centered on the top edge, sunk TAB_OVERLAP_MM into the plate. The
    // outer and inner stadiums share cap centers (equal length - width),
    // giving the ring extrusion its required 1:1 point correspondence.
    const cy = sizeMm + tabWidth / 2 - TAB_OVERLAP_MM
    const outer = stadiumOutline(sizeMm / 2, cy, tabLength, tabWidth)
    const inner = stadiumOutline(sizeMm / 2, cy, SLOT_LENGTH_MM, SLOT_WIDTH_MM)
    addRingExtrusion(baseMesh, outer, inner, 0, thicknessMm)
  }

  const qrMesh: Mesh = { vertices: [], triangles: [] }
  for (let r = 0; r < n; r++) {
    // Merge horizontal runs of dark modules into single boxes.
    let c = 0
    while (c < n) {
      if (!matrix[r][c]) {
        c++
        continue
      }
      let end = c
      while (end < n && matrix[r][end]) end++
      // Row 0 is the top of the code, which is the highest y on the plate.
      const yTop = sizeMm - margin - r * pitch
      addBox(
        qrMesh,
        margin + c * pitch,
        yTop - pitch,
        thicknessMm,
        margin + end * pitch,
        yTop,
        thicknessMm + reliefMm,
      )
      c = end
    }
  }

  return { base: baseMesh, qr: qrMesh }
}

/**
 * Builds the .3mf file (a zip archive per the 3MF spec) and returns its
 * bytes. Throws RangeError when options fall outside printable limits.
 */
export function generateQr3mf(
  text: string,
  options: Qr3mfOptions,
): Uint8Array<ArrayBuffer> {
  const { sizeMm, thicknessMm, quietZoneComponents, reliefMm } = options
  const minSize = computeMinSizeMm(text, quietZoneComponents)
  if (!Number.isFinite(sizeMm) || sizeMm < minSize || sizeMm > QR3MF_LIMITS.maxSizeMm) {
    throw new RangeError(
      `sizeMm must be between ${minSize} and ${QR3MF_LIMITS.maxSizeMm}, got ${sizeMm}`,
    )
  }
  if (
    !Number.isFinite(thicknessMm) ||
    thicknessMm < QR3MF_LIMITS.minThicknessMm ||
    thicknessMm > QR3MF_LIMITS.maxThicknessMm
  ) {
    throw new RangeError(
      `thicknessMm must be between ${QR3MF_LIMITS.minThicknessMm} and ${QR3MF_LIMITS.maxThicknessMm}, got ${thicknessMm}`,
    )
  }
  if (
    !Number.isFinite(quietZoneComponents) ||
    quietZoneComponents < QR3MF_LIMITS.minQuietZoneComponents ||
    quietZoneComponents > QR3MF_LIMITS.maxQuietZoneComponents
  ) {
    throw new RangeError(
      `quietZoneComponents must be between ${QR3MF_LIMITS.minQuietZoneComponents} and ${QR3MF_LIMITS.maxQuietZoneComponents}, got ${quietZoneComponents}`,
    )
  }
  if (
    !Number.isFinite(reliefMm) ||
    reliefMm < QR3MF_LIMITS.minReliefMm ||
    reliefMm > QR3MF_LIMITS.maxReliefMm
  ) {
    throw new RangeError(
      `reliefMm must be between ${QR3MF_LIMITS.minReliefMm} and ${QR3MF_LIMITS.maxReliefMm}, got ${reliefMm}`,
    )
  }

  const { base: baseMesh, qr: qrMesh } = buildQr3mfMeshes(text, options)

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">BadgeTag QR tag</metadata>` +
    `<resources>` +
    `<basematerials id="1">` +
    `<base name="Base (light)" displaycolor="#FFFFFF" />` +
    `<base name="QR code (dark)" displaycolor="#1F2937" />` +
    `</basematerials>` +
    `<object id="2" type="model" name="Base plate" pid="1" pindex="0">${meshXml(baseMesh)}</object>` +
    `<object id="3" type="model" name="QR code" pid="1" pindex="1">${meshXml(qrMesh)}</object>` +
    `</resources>` +
    `<build><item objectid="2" /><item objectid="3" /></build>` +
    `</model>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />` +
    `</Types>`

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />` +
    `</Relationships>`

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }) as Uint8Array<ArrayBuffer>
}
