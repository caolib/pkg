/**
 * PackageTable 鼠标交互回归测试。
 *
 * 运行：bun tests/package-table-mouse.tsx
 */
import { testRender } from "@opentui/react/test-utils"
import { act, useState } from "react"
import { PackageTable, type TableColumn } from "../src/components/PackageTable"

interface Row {
  key: string
  name: string
}

const rows: Row[] = Array.from({ length: 8 }, (_, index) => ({
  key: String(index),
  name: `package-${index}`,
}))

const columns: TableColumn<Row>[] = [
  { key: "name", label: "Name", width: 20, render: (row) => row.name },
]

function TestTable(props: {
  onSelect: (key: string) => void
  onOpen: (key: string) => void
}) {
  const [cursor, setCursor] = useState(5)

  return (
    <PackageTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      cursor={cursor}
      visibleRows={3}
      onRowClick={(row, index) => {
        props.onSelect(row.key)
        setCursor(index)
      }}
      onRowDoubleClick={(row) => props.onOpen(row.key)}
    />
  )
}

async function main() {
  let failures = 0
  const selected: string[] = []
  const opened: string[] = []
  const check = (condition: boolean, message: string) => {
    if (condition) console.log("  ✓", message)
    else {
      failures++
      console.log("  ✗", message)
    }
  }

  const setup = await testRender(
    <TestTable
      onSelect={(key) => selected.push(key)}
      onOpen={(key) => opened.push(key)}
    />,
    { width: 30, height: 6 },
  )

  try {
    await setup.renderOnce()
    check(setup.captureCharFrame().includes("package-3"), "初始滚动窗口正确")

    await act(async () => {
      await setup.mockMouse.click(2, 2)
    })
    await setup.renderOnce()
    const afterSingleClick = setup.captureCharFrame()
    check(afterSingleClick.includes("package-3"), "单击后保留当前滚动窗口")
    check(selected.length === 1 && selected[0] === "4", "单击选中对应数据行")
    check(opened.length === 0, "单击不打开详情")

    await act(async () => {
      await setup.mockMouse.doubleClick(2, 3)
    })
    await setup.renderOnce()
    check(opened.length === 1 && opened[0] === "5", "双击同一行打开对应详情")

    console.log(
      failures === 0
        ? "\n=== [ALL OK] 表格鼠标测试通过 ==="
        : `\n=== 表格鼠标测试有 ${failures} 项未通过 ===`,
    )
  } finally {
    await act(async () => {
      setup.renderer.destroy()
    })
  }

  if (failures > 0) process.exit(1)
}

main()
