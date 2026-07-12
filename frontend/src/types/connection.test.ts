import { mapConnection } from './connection'

describe('mapConnection', () => {
  it('maps every snake_case field to camelCase', () => {
    const mapped = mapConnection({
      id: 'abc123',
      name: 'Grace Hopper',
      notes: 'Follow up re: COBOL',
      event: 'AWS re:Invent',
      photo_url: '/images/xyz789',
      source_profile_id: 'xyz789',
      created_at: '2024-01-01T00:00:00Z',
    })

    expect(mapped).toEqual({
      id: 'abc123',
      name: 'Grace Hopper',
      notes: 'Follow up re: COBOL',
      event: 'AWS re:Invent',
      photoUrl: '/images/xyz789',
      sourceProfileId: 'xyz789',
      createdAt: '2024-01-01T00:00:00Z',
    })
  })

  it('handles a minimal item with only required fields', () => {
    const mapped = mapConnection({
      id: 'abc123',
      name: 'Grace Hopper',
      created_at: '2024-01-01T00:00:00Z',
    })

    expect(mapped.notes).toBeUndefined()
    expect(mapped.event).toBeUndefined()
    expect(mapped.photoUrl).toBeUndefined()
    expect(mapped.sourceProfileId).toBeUndefined()
  })
})
