import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SaveConnectionModal } from './SaveConnectionModal'

const prefill = {
  name: 'Ada Lovelace',
  photoUrl: '/images/abc123',
  sourceProfileId: 'abc123',
}

describe('SaveConnectionModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when closed', () => {
    render(
      <SaveConnectionModal isOpen={false} onClose={vi.fn()} idToken="token" prefill={prefill} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the prefilled name and photo when open', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })

    render(
      <SaveConnectionModal isOpen={true} onClose={vi.fn()} idToken="token" prefill={prefill} />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByAltText("Ada Lovelace's profile photo")).toHaveAttribute(
      'src',
      '/images/abc123',
    )
  })

  it('populates the event datalist from existing connections', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ event: 'AWS re:Invent' }, { event: 'DevDay' }]),
    })

    render(
      <SaveConnectionModal isOpen={true} onClose={vi.fn()} idToken="token" prefill={prefill} />,
    )

    await waitFor(() => {
      expect(screen.getByText('AWS re:Invent')).toBeInTheDocument()
    })
    expect(screen.getByText('DevDay')).toBeInTheDocument()
  })

  it('saves the connection with the prefilled data plus entered notes/event', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })

    render(
      <SaveConnectionModal isOpen={true} onClose={vi.fn()} idToken="test-token" prefill={prefill} />,
    )

    fireEvent.change(screen.getByLabelText(/Event/), { target: { value: 'AWS re:Invent' } })
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.getByText(/Saved Ada Lovelace/)).toBeInTheDocument()
    })

    const postCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => init?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1].body as string)
    expect(body).toEqual({
      name: 'Ada Lovelace',
      photo_url: '/images/abc123',
      source_profile_id: 'abc123',
      notes: 'Follow up',
      event: 'AWS re:Invent',
    })
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })

    render(
      <SaveConnectionModal isOpen={true} onClose={onClose} idToken="token" prefill={prefill} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error message when the save fails', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: false, status: 500 })

    render(
      <SaveConnectionModal isOpen={true} onClose={vi.fn()} idToken="token" prefill={prefill} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save Connection' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save connection')
    })
  })
})
