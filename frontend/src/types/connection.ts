/** A person the signed-in user met and saved. */
export interface Connection {
  id: string
  name: string
  notes?: string
  event?: string
  photoUrl?: string
  sourceProfileId?: string
  createdAt: string
}

/** Maps the API's snake_case connection shape to the frontend's camelCase type. */
export function mapConnection(data: {
  id: string
  name: string
  notes?: string
  event?: string
  photo_url?: string
  source_profile_id?: string
  created_at: string
}): Connection {
  return {
    id: data.id,
    name: data.name,
    notes: data.notes,
    event: data.event,
    photoUrl: data.photo_url,
    sourceProfileId: data.source_profile_id,
    createdAt: data.created_at,
  }
}
