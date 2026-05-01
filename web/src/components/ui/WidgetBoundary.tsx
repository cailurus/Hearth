/**
 * Per-widget error boundary. A failure inside one widget (e.g. malformed
 * config JSON, runtime crash in a third-party render) is caught here and
 * shown as a small "widget failed / retry" tile, so the rest of the
 * dashboard keeps rendering. The global ErrorBoundary in App.tsx is the
 * last-resort net for crashes that escape this layer.
 */

import { Component, Fragment, type ReactNode } from 'react'

interface WidgetBoundaryProps {
    children: ReactNode
    /** Localized label shown above the retry button. */
    fallbackLabel: string
    /** Localized label for the retry button. */
    retryLabel: string
}

interface WidgetBoundaryState {
    error: Error | null
    /** Bumped on every Retry click so children remount with fresh state. */
    resetKey: number
}

export class WidgetBoundary extends Component<WidgetBoundaryProps, WidgetBoundaryState> {
    state: WidgetBoundaryState = { error: null, resetKey: 0 }

    static getDerivedStateFromError(error: Error): Partial<WidgetBoundaryState> {
        return { error }
    }

    componentDidCatch(error: Error) {
        // Surface the error in the dev console; production logs aggregators
        // can pick it up via the standard window 'error' channel.
        // eslint-disable-next-line no-console
        console.error('[WidgetBoundary] caught:', error)
    }

    private handleReset = () => {
        this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex h-full items-center justify-center">
                    <div className="space-y-1.5 text-center text-xs text-white/50">
                        <div>{this.props.fallbackLabel}</div>
                        <button
                            type="button"
                            onClick={this.handleReset}
                            className="text-white/70 underline transition-colors hover:text-white"
                        >
                            {this.props.retryLabel}
                        </button>
                    </div>
                </div>
            )
        }
        return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
    }
}

export default WidgetBoundary
