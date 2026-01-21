import { ComboBox } from './ComboBox'

export interface TimezonePickerProps {
    value: string
    onChange: (v: string) => void
    options: string[]
    placeholder?: string
}

/**
 * Timezone picker component with search functionality
 */
export function TimezonePicker({
    value,
    onChange,
    options,
    placeholder,
}: TimezonePickerProps) {
    return (
        <ComboBox<string>
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            getOptionLabel={(s) => s}
            onPick={(s) => onChange(s)}
        />
    )
}

export default TimezonePicker
