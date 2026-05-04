// app/server/src/routes/external-tasks.ts
//
// GET /api/external-tasks
//
// Surfaces "today's tasks" from Notion so the dashboard can show what
// the human is supposed to be working on alongside what their agents
// are actually doing. Configuration (token, db id) lives in
// `config.ts`. When the bridge is unconfigured this returns a
// well-formed empty response with `configured: false` so the client
// can render an opt-in hint without special-casing 404s.

import { Hono } from 'hono'
import { getNotionTasks } from '../services/notion-tasks'
import { apiError } from '../errors'

const router = new Hono()

router.get('/external-tasks', async (c) => {
  try {
    const result = await getNotionTasks()
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[external-tasks]', message)
    return apiError(c, 502, 'Notion fetch failed', { details: message })
  }
})

export default router
