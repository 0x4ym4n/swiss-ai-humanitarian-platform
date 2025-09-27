import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
    const [health, qdrantReady] = await Promise.all([
      fetch(`${base}/api/vectorstore/health/`).then(r => r.json()).catch(() => ({ status: 'down' })),
      fetch('http://localhost:6333/readyz').then(r => r.text()).catch(() => 'not ready'),
    ])
    return NextResponse.json({ api: health, qdrant: qdrantReady })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}


