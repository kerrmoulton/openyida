# 权限组和组织矩阵管理

权限组只影响指定表单，矩阵属于组织资源。先按用户要维护的对象选择操作。

## 权限组管理

```bash
openyida permission-manage copy APP_XXX FORM_XXX PACKAGE_XXX --dry-run
openyida permission-manage rename APP_XXX FORM_XXX PACKAGE_XXX --name 新名称
openyida permission-manage delete APP_XXX FORM_XXX PACKAGE_XXX --confirm
```

权限组通过 --package-type 区分 VIEW 和 START，默认 VIEW。不传 --name 的复制使用平台同表原生复制接口，未知成员排除等由服务端复制，不从显示成员列表重建；返回新 UUID 并核对可见维度，不能声称已核验不可读的配置。带 --name 的复制及重命名需原定义完整可读，否则零写入拒绝。删除必须有用户删除意图，--dry-run 不写远端。结果未知先回读，不能再次复制产生重复组。

## 组织矩阵管理

```bash
openyida matrix list --page 1 --limit 20
openyida matrix detail MATRIX_XXX
openyida matrix references MATRIX_XXX
openyida matrix rows MATRIX_XXX
openyida matrix create --file .cache/openyida/task/matrix.json --dry-run
openyida matrix update MATRIX_XXX --file .cache/openyida/task/matrix-patch.json --expect <detail返回的fingerprint> --dry-run
openyida matrix delete MATRIX_XXX --confirm
openyida matrix upsert-rows MATRIX_XXX --file .cache/openyida/task/rows.json --dry-run
openyida matrix delete-rows MATRIX_XXX --file .cache/openyida/task/row-ids.json --confirm
```

矩阵属于组织资源，普通受管应用任务不能借此修改组织资源。CLI 先查询管理可用性；不可用或未知则停止，不自行修改权益。list/rows/references 返回分页与完整性，不把一页当全集。update 合并顶层 name、description、admins、content，其余未提供项保持；content 是完整原生矩阵表定义（condition、result、config），修改前 detail 备份并核对现有列 ID。name/description 用原生 i18n 对象，admins 用查询得到的人员对象数组；不得编造列或人员 ID。upsert-rows 文件为原生行对象数组，delete-rows 为真实 rowId 字符串数组。删除矩阵前检查全部引用总数，非零／未知均停止。所有写入后独立回读，verification=inspect_readback 表示仍须核对请求字段及未修改字段，不能声称运行已验证。
