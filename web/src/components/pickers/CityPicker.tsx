import { ComboBox } from './ComboBox'
import type { GeocodeResult } from '../../types'

export interface CityPickerProps {
    value: string
    onChange: (v: string) => void
    onPick?: (v: string, option?: GeocodeResult) => void
    options: Array<string | GeocodeResult>
    placeholder?: string
}

/**
 * City picker component with search functionality
 */
export function CityPicker({
    value,
    onChange,
    onPick,
    options,
    placeholder,
}: CityPickerProps) {
    return (
        <ComboBox<string | GeocodeResult>
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            getOptionLabel={(s) => typeof s === 'string' ? s : s.displayName}
            onPick={(s) => {
                const label = typeof s === 'string' ? s : s.displayName
                onChange(label)
                onPick?.(label, typeof s === 'string' ? undefined : s)
            }}
        />
    )
}

export default CityPicker
