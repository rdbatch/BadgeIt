import { unzipSync, strFromU8 } from 'fflate'
import {
  buildQr3mfMeshes,
  computeMinSizeMm,
  computeModuleCount,
  DEFAULT_QUIET_ZONE_COMPONENTS,
  DEFAULT_RELIEF_MM,
  generateQr3mf,
  QR3MF_LIMITS,
} from './qr3mf'

const TEST_URL = 'https://badgetag.me/p/abc123def456'

const VALID_OPTIONS = {
  sizeMm: 60,
  thicknessMm: 3,
  lanyardLoop: true,
  quietZoneComponents: DEFAULT_QUIET_ZONE_COMPONENTS,
  reliefMm: DEFAULT_RELIEF_MM,
}

interface ParsedMesh {
  vertices: Array<[number, number, number]>
  triangles: Array<[number, number, number]>
}

interface ParsedObject {
  name: string
  pindex: string
  mesh: ParsedMesh
}

function parseModel(data: Uint8Array): { doc: Document; objects: ParsedObject[] } {
  const files = unzipSync(data)
  const model = files['3D/3dmodel.model']
  expect(model).toBeDefined()

  const doc = new DOMParser().parseFromString(strFromU8(model), 'text/xml')
  const objects = Array.from(doc.getElementsByTagName('object')).map((obj) => {
    const vertices = Array.from(obj.getElementsByTagName('vertex')).map(
      (v): [number, number, number] => [
        Number(v.getAttribute('x')),
        Number(v.getAttribute('y')),
        Number(v.getAttribute('z')),
      ],
    )
    const triangles = Array.from(obj.getElementsByTagName('triangle')).map(
      (t): [number, number, number] => [
        Number(t.getAttribute('v1')),
        Number(t.getAttribute('v2')),
        Number(t.getAttribute('v3')),
      ],
    )
    return {
      name: obj.getAttribute('name') ?? '',
      pindex: obj.getAttribute('pindex') ?? '',
      mesh: { vertices, triangles },
    }
  })
  return { doc, objects }
}

function boundingBox(mesh: ParsedMesh) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const v of mesh.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], v[axis])
      max[axis] = Math.max(max[axis], v[axis])
    }
  }
  return { min, max }
}

/**
 * A closed (watertight) triangle mesh has every directed edge appearing
 * exactly once, paired with its reverse. Non-manifold or open geometry
 * would fail to slice into a solid.
 */
function expectWatertight(mesh: ParsedMesh) {
  const edges = new Map<string, number>()
  for (const [a, b, c] of mesh.triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${from}>${to}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of edges) {
    expect(count).toBe(1)
    const [from, to] = key.split('>')
    expect(edges.get(`${to}>${from}`)).toBe(1)
  }
}

describe('computeMinSizeMm', () => {
  it('scales with module count so components never drop below the printable pitch', () => {
    const modules = computeModuleCount(TEST_URL)
    // Version 1 is 21 modules; any URL is larger. Default quiet zone adds 3
    // (1.5 components per side).
    expect(modules).toBeGreaterThanOrEqual(21)
    expect(computeMinSizeMm(TEST_URL)).toBe(
      Math.ceil((modules + 2 * DEFAULT_QUIET_ZONE_COMPONENTS) * QR3MF_LIMITS.minModuleMm),
    )
  })

  it('requires a larger minimum for longer URLs (denser codes)', () => {
    const longUrl = `${TEST_URL}${'x'.repeat(80)}`
    expect(computeMinSizeMm(longUrl)).toBeGreaterThan(computeMinSizeMm(TEST_URL))
  })

  it('shrinks the minimum when a smaller quiet zone is requested', () => {
    const wide = computeMinSizeMm(TEST_URL, QR3MF_LIMITS.maxQuietZoneComponents)
    const narrow = computeMinSizeMm(TEST_URL, QR3MF_LIMITS.minQuietZoneComponents)
    expect(narrow).toBeLessThan(wide)
  })
})

describe('generateQr3mf', () => {
  it('produces a valid 3MF container with required OPC parts', () => {
    const files = unzipSync(generateQr3mf(TEST_URL, VALID_OPTIONS))
    expect(files['[Content_Types].xml']).toBeDefined()
    expect(files['_rels/.rels']).toBeDefined()
    expect(files['3D/3dmodel.model']).toBeDefined()
  })

  it('contains two separately-colorable objects, both in the build', () => {
    const { doc, objects } = parseModel(generateQr3mf(TEST_URL, VALID_OPTIONS))

    expect(objects).toHaveLength(2)
    expect(objects.map((o) => o.name)).toEqual(['Base plate', 'QR code'])
    // Distinct material indices are what let slicers assign two colors.
    expect(objects[0].pindex).not.toBe(objects[1].pindex)
    expect(doc.getElementsByTagName('base')).toHaveLength(2)
    expect(doc.getElementsByTagName('item')).toHaveLength(2)
  })

  it('generates watertight meshes for both parts', () => {
    const { objects } = parseModel(generateQr3mf(TEST_URL, VALID_OPTIONS))
    for (const obj of objects) {
      expect(obj.mesh.triangles.length).toBeGreaterThan(0)
      expectWatertight(obj.mesh)
    }
  })

  it('triangle indices all reference existing vertices', () => {
    const { objects } = parseModel(generateQr3mf(TEST_URL, VALID_OPTIONS))
    for (const obj of objects) {
      for (const tri of obj.mesh.triangles) {
        for (const index of tri) {
          expect(Number.isInteger(index)).toBe(true)
          expect(index).toBeGreaterThanOrEqual(0)
          expect(index).toBeLessThan(obj.mesh.vertices.length)
        }
      }
    }
  })

  it('sizes the base plate to sizeMm x sizeMm x thicknessMm', () => {
    const { objects } = parseModel(
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, lanyardLoop: false }),
    )
    const { min, max } = boundingBox(objects[0].mesh)
    expect(min).toEqual([0, 0, 0])
    expect(max[0]).toBe(60)
    expect(max[1]).toBe(60)
    expect(max[2]).toBe(3)
  })

  it('raises the QR relief on top of the plate, inside the quiet zone', () => {
    const { objects } = parseModel(
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, lanyardLoop: false }),
    )
    const { min, max } = boundingBox(objects[1].mesh)
    // Sits on the plate surface with a thin, constant relief.
    expect(min[2]).toBe(3)
    expect(max[2]).toBeGreaterThan(3)
    expect(max[2]).toBeLessThanOrEqual(3 + DEFAULT_RELIEF_MM)
    // Quiet zone margin on all sides.
    expect(min[0]).toBeGreaterThan(0)
    expect(min[1]).toBeGreaterThan(0)
    expect(max[0]).toBeLessThan(60)
    expect(max[1]).toBeLessThan(60)
  })

  it('extends the base above the plate when the lanyard loop is enabled', () => {
    const withLoop = parseModel(
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, lanyardLoop: true }),
    )
    const withoutLoop = parseModel(
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, lanyardLoop: false }),
    )

    const loopBox = boundingBox(withLoop.objects[0].mesh)
    const plainBox = boundingBox(withoutLoop.objects[0].mesh)
    expect(plainBox.max[1]).toBe(60)
    // Tab is 9mm tall, sunk 2mm into the plate.
    expect(loopBox.max[1]).toBe(67)
    // The loop is part of the base object, not a third part.
    expect(withLoop.objects).toHaveLength(2)
  })

  it('shrinks the quiet zone margin when quietZoneComponents is reduced', () => {
    const wide = parseModel(
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        lanyardLoop: false,
        quietZoneComponents: QR3MF_LIMITS.maxQuietZoneComponents,
      }),
    )
    const narrow = parseModel(
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        lanyardLoop: false,
        quietZoneComponents: QR3MF_LIMITS.minQuietZoneComponents,
      }),
    )

    const wideMargin = boundingBox(wide.objects[1].mesh).min[0]
    const narrowMargin = boundingBox(narrow.objects[1].mesh).min[0]
    expect(narrowMargin).toBeLessThan(wideMargin)
  })

  it('raises the relief by the requested reliefMm', () => {
    const { objects } = parseModel(
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        lanyardLoop: false,
        reliefMm: 1.2,
      }),
    )
    const { min, max } = boundingBox(objects[1].mesh)
    expect(min[2]).toBe(3)
    expect(max[2]).toBe(3 + 1.2)
  })

  it('rejects sizes below the scannability minimum', () => {
    const min = computeMinSizeMm(TEST_URL)
    expect(() =>
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, sizeMm: min - 1 }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, sizeMm: min }),
    ).not.toThrow()
  })

  it('rejects sizes and thicknesses outside the printable limits', () => {
    expect(() =>
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, sizeMm: QR3MF_LIMITS.maxSizeMm + 1 }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        thicknessMm: QR3MF_LIMITS.minThicknessMm - 0.1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        thicknessMm: QR3MF_LIMITS.maxThicknessMm + 0.1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, { ...VALID_OPTIONS, sizeMm: Number.NaN }),
    ).toThrow(RangeError)
  })

  it('rejects quiet zones outside the printable/scannable limits', () => {
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        quietZoneComponents: QR3MF_LIMITS.minQuietZoneComponents - 0.1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        quietZoneComponents: QR3MF_LIMITS.maxQuietZoneComponents + 0.1,
      }),
    ).toThrow(RangeError)
  })

  it('rejects relief heights outside the printable limits', () => {
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        reliefMm: QR3MF_LIMITS.minReliefMm - 0.1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      generateQr3mf(TEST_URL, {
        ...VALID_OPTIONS,
        reliefMm: QR3MF_LIMITS.maxReliefMm + 0.1,
      }),
    ).toThrow(RangeError)
  })
})

describe('buildQr3mfMeshes', () => {
  it('produces the same geometry the .3mf exporter packages', () => {
    const meshes = buildQr3mfMeshes(TEST_URL, VALID_OPTIONS)
    const { objects } = parseModel(generateQr3mf(TEST_URL, VALID_OPTIONS))
    const [base, qr] = objects

    expect(meshes.base.vertices.length / 3).toBe(base.mesh.vertices.length)
    expect(meshes.base.triangles.length / 3).toBe(base.mesh.triangles.length)
    expect(meshes.qr.vertices.length / 3).toBe(qr.mesh.vertices.length)
    expect(meshes.qr.triangles.length / 3).toBe(qr.mesh.triangles.length)
  })

  it('raises the QR relief above the base plate', () => {
    const meshes = buildQr3mfMeshes(TEST_URL, VALID_OPTIONS)
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 2; i < meshes.qr.vertices.length; i += 3) {
      minZ = Math.min(minZ, meshes.qr.vertices[i])
      maxZ = Math.max(maxZ, meshes.qr.vertices[i])
    }
    expect(minZ).toBe(VALID_OPTIONS.thicknessMm)
    expect(maxZ).toBeCloseTo(VALID_OPTIONS.thicknessMm + VALID_OPTIONS.reliefMm)
  })

  it('only adds the lanyard tab when requested', () => {
    const withLoop = buildQr3mfMeshes(TEST_URL, VALID_OPTIONS)
    const without = buildQr3mfMeshes(TEST_URL, {
      ...VALID_OPTIONS,
      lanyardLoop: false,
    })
    // A bare plate is a single box: 8 corner vertices.
    expect(without.base.vertices.length / 3).toBe(8)
    expect(withLoop.base.vertices.length / 3).toBeGreaterThan(8)
  })
})
