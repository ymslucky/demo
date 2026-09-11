/** zh 词表：按域拆分的命名空间文件在此聚合（键结构与拆分前一致，
 *  由 tests/i18n.test.ts 强制 zh/en 同构）。 */
import admin from "./admin.json";
import blog from "./blog.json";
import contact from "./contact.json";
import core from "./core.json";
import home from "./home.json";
import links from "./links.json";
import tools from "./tools.json";
import unit from "./unit.json";

const zh = {
  ...core,
  ...admin,
  ...home,
  ...blog,
  ...links,
  ...contact,
  ...tools,
  ...unit,
};

export default zh;
