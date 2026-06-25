import { Select } from '@mantine/core'
import { useFY } from '../fy'

export default function FYSelect() {
  const { fy, setFy, years } = useFY()
  return (
    <Select
      label="Financial year"
      size="xs"
      allowDeselect={false}
      data={years}
      value={fy}
      onChange={v => v && setFy(v)}
    />
  )
}
