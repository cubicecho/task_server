import type { ComponentProps } from "react";
import {
  bindToForm,
  type FieldProps,
  splitProps,
  useFieldContext,
  useFieldError,
} from "@/components/app-form";
import { FormField } from "@/components/form-field";
import { ModelSelect } from "@/components/model-select";

type ModelSelectFieldProps = FieldProps &
  Omit<ComponentProps<typeof ModelSelect>, "id" | "value" | "onChange">;

/**
 * `ModelSelect` as a bound field.
 *
 * Written with `bindToForm` rather than as a `ModelSelect` inside a `FormField`: its root is a
 * Radix `Select`, which renders no DOM, so the id and the `aria-*` props have to reach the
 * trigger through the function form of `control` — the same reason `SelectField` exists.
 */
function BoundModelSelectField(props: ModelSelectFieldProps) {
  const [fieldProps, control] = splitProps(props);
  const field = useFieldContext<string>();
  const error = useFieldError();

  return (
    <FormField
      {...fieldProps}
      error={error}
      control={(wired) => (
        <ModelSelect
          {...control}
          {...wired}
          value={field.state.value ?? ""}
          onChange={field.handleChange}
        />
      )}
    />
  );
}

export const ModelSelectField = bindToForm<ModelSelectFieldProps, string>(
  BoundModelSelectField,
  "ModelSelectField",
);
