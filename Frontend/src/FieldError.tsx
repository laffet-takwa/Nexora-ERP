type Props = {
  /** id of the message, referenced by the input's aria-describedby. */
  id?: string
  message?: string | null
}

/**
 * Inline validation message for a single form field.
 *
 * Surfaces the specific backend rule that failed instead of collapsing every
 * validation failure into one generic banner.
 */
export function FieldError({ id, message }: Props) {
  if (!message) return null

  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  )
}