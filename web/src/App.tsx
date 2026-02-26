import { Component, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-white">
          <div className="max-w-md text-center">
            <h1 className="mb-4 text-2xl font-bold">Something went wrong</h1>
            <p className="mb-6 text-white/60">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <div className="min-h-full">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<HomePage initialDialog="login" />} />
        </Routes>
      </ErrorBoundary>
    </div>
  )
}
