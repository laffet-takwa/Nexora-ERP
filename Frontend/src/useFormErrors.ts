import { useCallback, useState } from 'react'
import { ApiError, describeError } from './api'

/**
 * Collects validation failures for a form.
 *
 * Laravel reports per-field problems under `errors`, so a duplicate SKU or a
 * password mismatch is shown next to the offending input instead of collapsing
 * into one generic banner. Only genuinely non-field failures use the banner.
 */
export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const reset = useCallback(() => {
    setFieldErrors({})
    setFormError('')
  }, [])

  const capture = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.hasFieldErrors) {
      const flattened: Record<string, string> = {}
      for (const [field, messages] of Object.entries(error.fields)) {
        const first = messages[0]
        if (first) flattened[field] = first
      }
      setFieldErrors(flattened)
      // The banner is cleared: every problem is now attached to its field.
      setFormError('')
      return
    }

    setFieldErrors({})
    setFormError(describeError(error, fallback))
  }, [])

  const fieldError = useCallback((field: string) => fieldErrors[field], [fieldErrors])

  return { fieldErrors, formError, fieldError, reset, capture }
}