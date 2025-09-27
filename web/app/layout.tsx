import './globals.css'
import React from 'react'
import Image from 'next/image'

function NavLink({ href, children }: { href: string, children: React.ReactNode }) {
  return (
    <a className="px-3 py-2 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-800" href={href}>{children}</a>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0f1115] text-gray-200">
        <header className="w-full border-b border-gray-800 bg-[#0b0d12]/90 backdrop-blur supports-[backdrop-filter]:bg-[#0b0d12]/70">
          <div className="w-full px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="Swiss Confederation logo"
                width={248}
                height={63}
                priority
                className="h-10 w-auto"
              />
              <div className="text-lg uppercase tracking-wider text-gray-400">Humane</div>
            </div>
            <nav className="flex items-center gap-1">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/ingest">Ingest</NavLink>
            </nav>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-sm">Christopher Citizen</div>
                <div className="text-xs text-gray-400">Program Officer</div>
              </div>
              <div className="h-8 w-8 rounded-full bg-gray-700" />
            </div>
          </div>
        </header>
        <main className="w-full px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
