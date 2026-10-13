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
 * The id and the `aria-*` props go in through the function form of `control`, and
 * `ModelSelect` puts them on whichever of its two controls is on screen.
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
