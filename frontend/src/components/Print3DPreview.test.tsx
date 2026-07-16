import { render, screen } from '@testing-library/react'
import Print3DPreview from './Print3DPreview'
import { DEFAULT_QUIET_ZONE_COMPONENTS, DEFAULT_RELIEF_MM } from '../lib/qr3mf'

const OPTIONS = {
  sizeMm: 60,
  thicknessMm: 3,
  lanyardLoop: true,
  quietZoneComponents: DEFAULT_QUIET_ZONE_COMPONENTS,
  reliefMm: DEFAULT_RELIEF_MM,
}

describe('Print3DPreview', () => {
  // jsdom has no WebGL, so the component's unsupported path is what we can
  // exercise here; the WebGL path is covered by the shared mesh builder's
  // own tests plus manual verification in a browser.
  it('falls back gracefully when WebGL is unavailable', () => {
    render(
      <Print3DPreview
        profileUrl="https://badgetag.me/p/abc123def456"
        options={OPTIONS}
      />,
    )
    expect(screen.getByText(/preview isn't available/i)).toBeInTheDocument()
  })
})
