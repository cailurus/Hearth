import { ComboBox } from './ComboBox'

export interface CityPickerProps {
    value: string
    onChange: (v: string) => void
    onPick?: (v: string) => void
    options: string[]
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
        <ComboBox<string>
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            getOptionLabel={(s) => s}
            onPick={(s) => {
                onChange(s)
                onPick?.(s)
            }}
        />
    )
}

export default CityPicker
