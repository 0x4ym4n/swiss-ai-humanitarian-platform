"use client"
import React from 'react'

export default function SudanMap({ highlightedState, height = 420 }: { highlightedState?: string, height?: number }) {
  const mapContainer = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<any>(null)
  const [availableStates, setAvailableStates] = React.useState<string[]>([])
  const [currentHighlight, setCurrentHighlight] = React.useState<string>(highlightedState || '')
  const [mapLoaded, setMapLoaded] = React.useState(false)
  const [mapError, setMapError] = React.useState<string | null>(null)

  React.useEffect(() => { setCurrentHighlight(highlightedState || '') }, [highlightedState])

  React.useEffect(() => {
    if (!mapContainer.current) return

    const initMap = async () => {
      try {
        // Import MapLibre GL dynamically
        const maplibregl = await import('maplibre-gl')

        console.log('Initializing Sudan map...')

        const map = new maplibregl.Map({
          container: mapContainer.current!,
          style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
          center: [30, 15], // Centered on Sudan
          zoom: 5.5,
          attributionControl: false
        })

        // Add navigation controls
        map.addControl(new maplibregl.NavigationControl(), 'top-right')

        map.on('load', async () => {
          console.log('Map loaded, fetching Sudan boundaries...')
          try {
            const response = await fetch('/sdadmbndaadm1.geojson')
            if (!response.ok) {
              throw new Error(`Failed to fetch GeoJSON: ${response.status}`)
            }

            const geojsonData = await response.json()
            console.log('GeoJSON loaded:', geojsonData.features?.length, 'features')

            // Extract available states
            const states = geojsonData.features
              .map((feature: any) => feature.properties?.admin1Name)
              .filter((name: string) => name)
              .sort()

            setAvailableStates(states)
            console.log('Available states:', states)

            // Add Sudan boundaries source
            map.addSource('sudan-boundaries', {
              type: 'geojson',
              data: geojsonData
            })

            // Add all boundaries layer (dark gray)
            map.addLayer({
              id: 'sudan-boundaries-fill',
              type: 'fill',
              source: 'sudan-boundaries',
              paint: {
                'fill-color': '#334155',
                'fill-opacity': 0.3
              }
            })

            // Add boundary lines
            map.addLayer({
              id: 'sudan-boundaries-line',
              type: 'line',
              source: 'sudan-boundaries',
              paint: {
                'line-color': '#475569',
                'line-width': 1
              }
            })

            // Add highlighted state layer
            map.addLayer({
              id: 'highlighted-state',
              type: 'fill',
              source: 'sudan-boundaries',
              paint: {
                'fill-color': '#ef4444',
                'fill-opacity': 0.6
              },
              filter: ['==', 'admin1Name', currentHighlight || '']
            })

            // Add highlighted state border
            map.addLayer({
              id: 'highlighted-state-border',
              type: 'line',
              source: 'sudan-boundaries',
              paint: {
                'line-color': '#dc2626',
                'line-width': 3
              },
              filter: ['==', 'admin1Name', currentHighlight || '']
            })

            // Add click handler
            map.on('click', 'sudan-boundaries-fill', (e: any) => {
              if (e.features && e.features[0]) {
                const stateName = e.features[0].properties?.admin1Name
                console.log('State clicked:', stateName)
                if (stateName) {
                  setCurrentHighlight(stateName)
                }
              }
            })

            // Change cursor on hover
            map.on('mouseenter', 'sudan-boundaries-fill', () => {
              map.getCanvas().style.cursor = 'pointer'
            })

            map.on('mouseleave', 'sudan-boundaries-fill', () => {
              map.getCanvas().style.cursor = ''
            })

            setMapLoaded(true)
            console.log('Sudan map fully initialized')
          } catch (e) {
            console.error('Failed to load Sudan boundaries:', e)
            setMapError('Failed to load map data')
          }
        })

        map.on('error', (e: any) => {
          console.error('Map error:', e)
          setMapError('Map rendering error')
        })

        mapRef.current = map
        setMapError(null)

      } catch (error) {
        console.error('Failed to initialize map:', error)
        setMapError('Failed to load map library')
      }
    }

    initMap()

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Update map filters when currentHighlight changes
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    console.log('Updating highlight for:', currentHighlight)

    try {
      const filter = ['==', 'admin1Name', currentHighlight || '']

      if (map.getLayer('highlighted-state')) {
        map.setFilter('highlighted-state', filter)
      }
      if (map.getLayer('highlighted-state-border')) {
        map.setFilter('highlighted-state-border', filter)
      }

      // Auto-fit to highlighted state if one is selected
      if (currentHighlight && map.getSource('sudan-boundaries')) {
        const source = map.getSource('sudan-boundaries')
        if (source && source._data && source._data.features) {
          const highlightedFeature = source._data.features.find(
            (feature: any) => feature.properties.admin1Name === currentHighlight
          )

          if (highlightedFeature && highlightedFeature.geometry) {
            try {
              // Import maplibre-gl dynamically for LngLatBounds
              import('maplibre-gl').then((maplibregl) => {
                const bbox = new maplibregl.LngLatBounds()
                const coords = highlightedFeature.geometry.coordinates[0]

                coords.forEach((coord: [number, number]) => {
                  bbox.extend(coord)
                })

                map.fitBounds(bbox, {
                  padding: 50,
                  maxZoom: 8,
                  duration: 1000
                })
              }).catch(() => {
                console.warn('Could not fit bounds for state:', currentHighlight)
              })
            } catch (boundError) {
              console.warn('Could not fit bounds for state:', currentHighlight)
            }
          }
        }
      } else if (!currentHighlight) {
        // Reset to full Sudan view
        map.easeTo({
          center: [30, 15],
          zoom: 5.5,
          duration: 1000
        })
      }
    } catch (error) {
      console.error('Error updating map filters:', error)
    }
  }, [currentHighlight, mapLoaded])

  return (
    <div className="space-y-4">
      {/* Map Container */}
      <div className="relative w-full rounded-lg overflow-hidden border border-gray-700 bg-gray-900" style={{ height }}>
        <div ref={mapContainer} className="absolute inset-0" />

        {/* Map Loading State and Error */}
        {(!mapLoaded || mapError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center">
              {mapError ? (
                <>
                  <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <p className="text-red-400 text-sm">{mapError}</p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-gray-400 text-sm">Loading Sudan map...</p>
                </>
              )}

              {/* Fallback SVG Map */}
              <div className="mt-8 opacity-30">
                <svg width="240" height="300" viewBox="0 0 240 300" className="mx-auto">
                  <path
                    d="M120 20 L200 60 L220 120 L200 180 L180 240 L120 280 L60 240 L40 180 L20 120 L40 60 Z"
                    fill="none"
                    stroke="#475569"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                  <text x="120" y="160" textAnchor="middle" fill="#6b7280" fontSize="14">
                    Sudan
                  </text>
                  <text x="120" y="180" textAnchor="middle" fill="#6b7280" fontSize="12">
                    {mapError ? 'Map Unavailable' : 'Map Loading...'}
                  </text>
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Highlighted State Indicator */}
        {currentHighlight && mapLoaded && !mapError && (
          <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm px-3 py-2 rounded-lg text-sm border border-gray-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              <span className="text-white font-medium">{currentHighlight}</span>
            </div>
          </div>
        )}

        {/* Map Controls - Only show when map is loaded */}
        {mapLoaded && !mapError && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-black/70 backdrop-blur-sm rounded-lg p-4 border border-gray-600">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-300 mb-1 block">Select State</label>
                  <select
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                    value={currentHighlight}
                    onChange={(e) => setCurrentHighlight(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-300 mb-1 block">Or type state name</label>
                  <input
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. Kassala"
                    value={currentHighlight}
                    onChange={e => setCurrentHighlight(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                    onClick={() => setCurrentHighlight('')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
