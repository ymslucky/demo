import RateLimiterDemo from "./RateLimiterDemo";
import CodeBlock from "../components/CodeBlock";

/**
 * 限流器文章的内容层。中文正文有意存放在此处（独立成篇的博客内容，
 * 豁免于 app 源码禁用 CJK 的规则）；所有展示层关注点都位于
 * components.css（.blog-* 系列类名）中。
 */
export default function PostBody() {
  return (
    <>
      {/* ============ 摘要 ============ */}
      <section className="blog-abstract">
        <p>
          <strong>摘　要：</strong>
          本地限流器是部署在服务进程内部、用于约束请求到达速率的基础组件。本文在统一的数学框架下，
          对固定窗口计数器、滑动窗口日志、漏桶与令牌桶四类经典本地限流算法进行系统化的形式化建模与分析。
          文中给出了各算法的状态机描述与伪代码，证明了固定窗口计数器的边界突刺上界定理与令牌桶惰性再填充的等价性定理，
          并从时间开销、空间开销、突发容忍能力与输出平滑性四个维度对四类算法进行了定量对比；
          最后结合 Guava RateLimiter、Stripe 与 Cloudflare 的生产实践，给出面向不同负载画像的工程选型建议。
          全部结论均可通过文中提供的交互式仿真进行复现。
        </p>
        <p className="blog-abstract-keywords">
          <strong>关键词：</strong>
          限流器；流量管制；漏桶算法；令牌桶；滑动窗口；ATM 网络；网络演算
        </p>
      </section>

      {/* ============ 1 引言 ============ */}
      <h2>1　引言</h2>
      <p>
        任何在线服务的可用资源——CPU 时间片、线程池、连接池与下游数据库配额——都是有界的。
        当请求到达速率在短时间内超过服务容量时，排队延迟将急剧上升甚至引发级联故障。
        <strong>限流器（rate limiter）</strong>通过显式地拒绝超量请求，将到达速率约束至系统承载范围之内，
        是过载保护的第一道防线<sup>[8]</sup>。业界通常以 HTTP 429（Too Many Requests）状态码
        配合 Retry-After 头部向客户端传达拒绝语义<sup>[8]</sup>。
      </p>
      <p>
        本文聚焦于<strong>本地限流器</strong>：即不依赖 Redis 等外部协调设施、仅在单进程内存内维护状态的限流算法。
        与分布式限流相比，本地方案具有零网络往返、无一致性协议开销的优势，同时其正确性与效率完全取决于内存数据结构的选择，
        因而是理解更复杂分布式方案的基石<sup>[9,10]</sup>。
      </p>
      <p>本文的主要贡献如下：</p>
      <ul>
        <li>建立统一的形式化模型：将限流问题抽象为对请求到达过程的包络约束，并给出五个正交的评价维度（第 3 节）；</li>
        <li>对四类经典算法给出状态机定义、伪代码与复杂度分析，并证明两个关键定理：固定窗口的边界突刺上界（第 4.1 节），以及令牌桶惰性再填充与理想连续充填的等价性（第 4.4 节）；</li>
        <li>提供一个交互式可复现仿真，用于验证理论推导中的突发吸收行为（第 6 节）；</li>
        <li>梳理从 1980 年代 ATM 流量管制到现代云厂商网关的技术脉络，据此给出工程选型矩阵（第 2、7 节）。</li>
      </ul>

      {/* ============ 2 相关工作 ============ */}
      <h2>2　相关工作</h2>
      <p>
        限流的思想可追溯至宽带综合业务数字网（B-ISDN／ATM）时代的<strong>流量管制（traffic policing）</strong>研究。
        Turner 于 1986 年提出的漏桶机制被普遍视为该领域的奠基性工作<sup>[1]</sup>。
        进入 1990 年代，随着 ATM 标准化推进，大量工作致力于评估各类管制机制的管制效果：
        Rathgeb 对多种管制机制进行了建模与性能比较<sup>[2]</sup>；
        Buttò 等人定量分析了漏桶机制对违规流量源的有效性，揭示了参数（桶深与泄露速率）选择的权衡<sup>[3]</sup>；
        Berger 则针对「令牌与作业均需排队」的速率控制节流器建立了排队论模型<sup>[4]</sup>。
      </p>
      <p>
        标准化方面，ITU-T 建议 I.371 与 ATM 论坛流量管理规范 4.1 给出了<strong>通用信元速率算法
        GCRA(I, L)</strong>的权威定义，并证明其存在虚拟调度与连续状态漏桶两种等价形式<sup>[5,6]</sup>——
        这构成了第 4.3 节漏桶分析的规范基础。理论侧，Le Boudec 与 Thiran 建立的网络演算（network calculus）
        以最小-加（min-plus）代数为工具，将令牌桶统一刻画为仿射到达曲线
        <span className="blog-inline-code">α(t) = rt + b</span>，为一切整形器/管制器提供了普适的下界框架<sup>[7]</sup>。
      </p>
      <p>
        在工程实践层面，Guava 的 SmoothRateLimiter 是 Java 生态中被广泛使用的本地令牌桶实现，
        其支持预热曲线等扩展特性<sup>[11]</sup>；分布式场景下，Stripe 提出了基于 Redis＋Lua 的
        生产级限流器族<sup>[9]</sup>，Cloudflare 则给出了一种大规模边缘场景下低内存占用的滑动窗口近似算法<sup>[10]</sup>。
        这些工作共享相同的内核思想，即本文所分析的四类原语。
      </p>

      {/* ============ 3 形式化模型 ============ */}
      <h2>3　问题形式化与评价维度</h2>
      <p>
        设请求按离散时刻<span className="blog-inline-code">a₁ &lt; a₂ &lt; …</span>到达。
        一个限流器可定义为四元组
        <span className="blog-inline-code">(Σ, Init, F, R)</span>：
        状态集 Σ、初始状态 Init、决策函数 F 与状态转移规则 R。
        对每个到达时刻 aᵢ，决策函数输出
        <span className="blog-inline-code">F(sᵢ₋₁, aᵢ) ∈ {'{'}接受, 拒绝{'}'}</span>，
        并据此产生新状态 sᵢ。采纳集合记为
        <span className="blog-inline-code">A(t) = Σᵢ·𝟙[aᵢ ≤ t ∧ 接受]</span>。
      </p>
      <p>
        借助网络演算的记号<sup>[7]</sup>，若某种算法保证任意时间窗 T 内的采纳数不超过
        <span className="blog-inline-code">b + rT</span>（其中 r 为承诺速率、b 为容许突发），
        则称该算法实现了仿射到达曲线约束。<strong>限流问题的本质即：给定资源上界，
        构造满足目标包络且决策代价最小的在线算法。</strong>
      </p>
      <p>我们采用以下五个维度评价具体算法：</p>
      <ul>
        <li><strong>时间复杂度</strong>：单次到达判定的摊还成本（关键路径是否含扫描或清理循环）；</li>
        <li><strong>空间复杂度</strong>：每个限流键所需维护的字节数（决定多租户扩展性）；</li>
        <li><strong>突发容忍</strong>：在不违反长期平均速率的前提下，瞬时允许的最大并发峰值；</li>
        <li><strong>输出平滑性</strong>：放行过程相对匀速基线的偏离程度；</li>
        <li><strong>精度</strong>：实际执行边界与名义包络的偏差。</li>
      </ul>

      {/* ============ 4 算法 ============ */}
      <h2>4　四类经典算法的形式化与分析</h2>

      <h3>4.1　固定窗口计数器（Fixed Window Counter）</h3>
      <p>
        该算法将时间轴划分为宽度 W 的半开区间，在每窗口内维护计数器 c 与窗口起点 t₀，
        令名义限额为每窗口 N 次。其状态机仅含两个标量，是最朴素的实现（算法 1）。
      </p>

      <CodeBlock
        title="算法 1 · 固定窗口计数器"
        code={`class FixedWindowRateLimiter {
  long windowStart = System.currentTimeMillis();
  int counter = 0;
  final int capacity = 100;      // N：每窗口限额
  final long windowSizeMs = 1000; // W：窗口宽度

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    if (now - windowStart > windowSizeMs) { // 滑入新窗口
      windowStart = now;
      counter = 0;
    }
    if (counter < capacity) {
      counter++;
      return true;
    }
    return false;
  }
}`} />

      <p>
        <strong>定理 1（边界突刺上界）。</strong>
        记 ρ = N/W 为名义速率。对任意跨越窗口边界的、长度小于 W 的区间，被采纳请求数的上界为 2N，
        即瞬时突发速率可达 2ρ。
      </p>
      <p>
        <em>证明梗概：</em>
        考察由上一窗口末尾 δ 个时隙与本一窗口开头 δ 个时隙构成的长度 2δ &lt; W 的拼接区间。
        两段分属不同的计数器作用域，各自独立地允许 N 次采纳，故该区间合计可放行 2N ≈ 2ρ·W。
        证毕。
      </p>

      <div className="blog-callout">
        <strong>评注 1.</strong><br />
        定理 1 表明：只要攻击者恰好同步在边界两侧注入流量，固定窗口的实际约束就退化为名义值的两倍。
        例如限额「每分钟 100 次」时，00:59 注入 100 次全部通过后，01:00 再注入 100 次仍可通过，
        两秒内的真实速率达 6000 次/分钟。消除这一缺陷需要打破窗口间的独立性——这正是滑动窗口的动机。
      </div>

      <h3>4.2　滑动窗口日志（Sliding Window Log）</h3>
      <p>
        滑动窗口放弃离散切分，改为记录最近 W 时段内<strong>每一次</strong>采纳的时间戳，
        使约束在连续时间轴上精确成立。判定时先淘汰过期项，再检查队列长度（算法 2）。
      </p>

      <CodeBlock
        title="算法 2 · 滑动窗口日志"
        code={`class SlidingWindowRateLimiter {
  Queue<Long> requests = new LinkedList<>();
  final int capacity = 100;       // N：窗口内限额
  final long windowSizeMs = 1000; // W：回溯窗长

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    while (!requests.isEmpty() && now - requests.peek() > windowSizeMs) {
      requests.poll(); // 淘汰窗外的历史采纳记录
    }
    if (requests.size() < capacity) {
      requests.add(now);
      return true;
    }
    return false;
  }
}`} />

      <p>
        <strong>性质 1（精确性与复杂度）。</strong>
        该算法精确实现了覆盖任意区间的最大值约束
        <span className="blog-inline-code">sup(A(t) − A(t−W)) ≤ N</span>，没有任何结构性误差。
        但每个采纳都伴随一次入队与出队，空间开销为 O(N)（更一般地为 O(λW)，λ 为到达速率）。
        当高并发多租户场景放大常数因子时，这一线性内存开销成为瓶颈。
      </p>
      <p>
        Cloudflare 为缓解上述问题提出了近似算法：保留当前与前一窗口的两个标量计数器，
        以加权估计代替全量日志，将空间压缩至 O(1)，代价是在窗口切换附近引入可控的统计误差<sup>[10]</sup>。
        这是「以精度换空间」的典型工程折衷。
      </p>

      <h3>4.3　漏桶与虚拟调度（Leaky Bucket / GCRA）</h3>
      <p>
        漏桶的语义不是限制「数量」，而是强制<strong>输出间隔恒定</strong>：请求如水滴入桶，
        服务端以固定节奏泄放，桶满则溢出（拒绝）。标准文献将其抽象为通用信元速率算法
        <strong>GCRA(I, L)</strong>，其中 I 为增量（理想到达间隔）、L 为极限容忍（迟到的宽限度），
        维护唯一状态——理论到达时刻 TAT（Theoretical Arrival Time）。规定若请求在 TAT − L 之后到达则为符合，
        并把 TAT 前移一个周期<sup>[5,6]</sup>（算法 3）。该规范同时给出了基于实数时钟的虚拟调度形式与基于计数器的
        连续状态漏桶形式，二者已被证明等价<sup>[5,6]</sup>。
      </p>

      <CodeBlock
        title="算法 3 · GCRA 虚拟调度"
        code={`class VirtualSchedulingPolicer {   // GCRA(I, L)
  double tat;                      // TAT：理论到达时刻
  final double incrementMs;       // I：理想到达间隔 1/r
  final double limitMs;           // L：迟到容忍 ~ 桶深

  boolean conforming(long arrivalTime) {
    double t = arrivalTime;
    if (t >= tat - limitMs) {      // 未严重早到 => 符合
      tat = Math.max(t, tat) + incrementMs;
      return true;
    }
    return false;                  // 过度密集 => 违约
  }
}`} />

      <p>
        <strong>性质 2（确定性整形）。</strong>
        GCRA 保证任何相邻两次采纳的间隔下界为 I − L，因此输出速率严格有界、方差趋近于零。
        这种硬性平滑正是早期电信设备防护脆弱解码器所需要的性质<sup>[1,3]</sup>；
        反之，它也是四类算法中对合法突发最不友好的——任何超出 L 的突发都被直接拒绝。
      </p>

      <h3>4.4　令牌桶与惰性再填充（Token Bucket）</h3>
      <p>
        令牌桶解耦了「平均速率」与「突发深度」：系统以速率 r 生成令牌，桶容量 b 封顶，
        每个请求消耗一枚令牌，空桶即拒绝。借助网络演算的语言，令牌桶恰是约束采纳过程满足
        仿射包络 <span className="blog-inline-code">A(t) − A(τ) ≤ b + r(t−τ)</span> 的最小允许函数<sup>[7]</sup>，
        相当于 GCRA 中取 L = b 的对称对偶<sup>[5,6]</sup>。Berger 的排队分析表明了此类带缓存
        节流器在突发负载下的稳定性条件<sup>[4]</sup>；Rathgeb 的比较研究则确认其在管制精度与突发友好性之间取得最佳平衡<sup>[2]</sup>。
      </p>

      <CodeBlock
        title="算法 4 · 令牌桶（惰性再填充）"
        code={`class TokenBucket {
  long lastRefillTime = System.currentTimeMillis();
  double currentTokens = 0;
  final double capacity = 10;         // b：桶深=最大突发
  final double refillRatePerMs = 0.01; // r：10 tokens/s

  synchronized boolean tryAcquire() {
    long now = System.currentTimeMillis();
    // 惰性计算：距上次更新应生成的令牌一次性补齐
    double generatedTokens = (now - lastRefillTime) * refillRatePerMs;
    currentTokens = Math.min(capacity, currentTokens + generatedTokens);
    lastRefillTime = now;

    if (currentTokens >= 1) {
      currentTokens -= 1;
      return true;
    }
    return false;
  }
}`} />

      <p>
        工程 实现从不出「定时生成令牌的后台线程」，而是像算法 4 那样在每次请求到达时，
        按经过时长 Δ = (now − last) · r 一次性补齐。直觉上这似乎只是优化，
        事实上它与理想连续充填在<strong>语义上完全等价</strong>。
      </p>
      <p>
        <strong>定理 2（惰性再填充等价性）。</strong>
        设理想算法在每个时刻 τ∈ℝ 按公式 x̃(τ) = min(b, x̃(τ₀) + r(τ − τ₀)) − Σ消耗演化，
        惰性算法仅在请求时刻 t₁, t₂, … 执行补齐。则二者在同一请求序列上的每次接受/拒绝判定相同。
      </p>
      <p>
        <em>证明梗概（对请求序号归纳）：</em>
        关键在于不变式「x(tₖ) = min(b, 上一锚点存量 + r·Δ) − 已扣减」，由于充填算子
        g(Δ, x) = min(b, x + rΔ) 关于 Δ 可复合（两个梯形截断的复合仍是单个截断），
        故把 [t₀, tₖ) 上无穷多次微小充填折叠为一次充填结果不变；
        同时判定仅依赖当前存量与阈值 1 的大小关系，而该值恒等于理想值。证毕。
      </p>

      <div className="blog-callout">
        <strong>推论 1.</strong><br />
        由定理 2，单次 tryAcquire 仅涉及 O(1) 次浮点运算与一次 min 截断，
        每个限流键的空间开销为常数（两个标量），无需任何后台调度——
        这是令牌桶成为工程默认选型的根本原因<sup>[9,11]</sup>。
      </div>

      {/* ============ 5 对比 ============ */}
      <h2>5　对比分析</h2>
      <p>
        综合前述分析，表 1 从五个维度汇总了各算法的性质。
      </p>

      <div className="blog-table-wrap">
        <table className="blog-table">
          <thead>
            <tr>
              {['算法', '时间', '空间', '突发容忍', '平滑性', '精度'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['固定窗口', 'O(1)', 'O(1)', '最差可达 2N', '差（边界突刺）', '低'],
              ['滑动窗口日志', 'O(1)* 摊还', 'O(N)', '无额外容忍', '好', '精确'],
              ['漏桶 / GCRA', 'O(1)', 'O(1)', '极弱（≈L）', '极好（间隔恒定）', '精确'],
              ['令牌桶', 'O(1)', 'O(1)', '强（≤ b+rT）', '中（突发透传）', '精确'],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="blog-figcaption">
          表 1　四类本地限流算法的性质对比（* 无竞争情形下单次请求摊还 O(1)，清理旧记录的成本被摊销）
        </p>
      </div>

      {/* ============ 6 实验 ============ */}
      <h2>6　交互式验证实验</h2>
      <p>
        为使第 4.4 节的理论结论可被直观检验，本文提供了一个可复现仿真实验（图 1）：
        参数取速率 r = 10 tokens/s、桶深 b = 10。读者可通过注入突发观察三个现象，
        它们分别对应定理 2 与性质 2 的预测：(i) 空闲期桶内存积的令牌恰好等于
        <span className="blog-inline-code">min(b, r·空闲时长)</span>；(ii) 一次规模 ≤ b 的突发可被完整吸收，
        而超过部分被拒绝；(iii) 长期速率收敛于 r，与短期抖动无关。
      </p>

      <figure className="blog-figure">
        <RateLimiterDemo />
        <figcaption className="blog-figcaption">
          图 1　令牌桶动态行为的交互式仿真（可在浏览器中直接操作）
        </figcaption>
      </figure>

      {/* ============ 7 工程实践 ============ */}
      <h2>7　工程实践与选型建议</h2>
      <p>
        <strong>单进程内</strong>，Guava 的 SmoothRateLimiter 在朴素令牌桶之上引入了两点改进：
        按请求粒度的预支计费（ant）与冷启动预热曲线（warming-up），以避免重启瞬间的缓存穿透风暴<sup>[11]</sup>；
        若业务仅需「过去 N 秒不超过 X 次」的语义且预算允许 O(N) 内存，滑动窗口日志依然是正确性首选<sup>[10]</sup>。
      </p>
      <p>
        <strong>跨节点扩展</strong>时，三种思路各有定位：
        (i) 以 Redis＋Lua 实现集中式令牌桶，配合实例间配额分享与客户端限流，Stripe 的实践表明该路线已可支撑
        数千万 rps 规模<sup>[9]</sup>；
        (ii) 以 GCRA 之类 O(1) 状态算法下沉到 API 网关逐跳执行；
        (iii) 采用 Cloudflare 式双计数器滑动窗口近似，在放宽强一致要求且内存极端受限的边缘 PoP 内获得准确实时控制<sup>[10]</sup>。
        无论何种实现，对外都应以 429 ＋ Retry-After 标准化拒绝响应<sup>[8]</sup>。
      </p>

      <div className="blog-summary">
        <h3>选型决策矩阵</h3>
        <ul>
          <li>追求极致简单、能接受 ×2 突刺且窗口较短：<strong>固定窗口计数器</strong></li>
          <li>要求对任意区间精确执法、内存预算充足：<strong>滑动窗口日志</strong></li>
          <li>保护严格串行/脆弱下游，必须匀速泄放：<strong>漏桶 / GCRA</strong></li>
          <li>通识默认款：既控均值又许突发，O(1) 时间空间：<strong>令牌桶（惰性再填充）</strong></li>
        </ul>
      </div>

      {/* ============ 8 结论 ============ */}
      <h2>8　结论与展望</h2>
      <p>
        本文将本地限流问题归结为带仿射包络约束的在线决策问题，并在该框架下完成了对四类经典算法的
        形式化重构：证明了固定窗口边界突刺的上界定理，指出滑动窗口以 O(N) 内存换取精确执法，
        借 GCRA 厘清了漏桶的确定性整形语义，并以复合不变式的归纳法证明了惰性再填充与理想令牌桶的等价性。
        对比结论清晰：在兼具突发容忍与常数开销的意义上，令牌桶是帕累托最优的默认选择，
        这与三十余年来的标准化进程和生产实践相互印证<sup>[2,5,9]</sup>。
      </p>
      <p>
        未来工作包括：多租户公平性（max-min fair share）、基于自适应反馈的动态限速、
        以及按成本而非次数记账的异构计费限流——三者均已超出仿射包络的表达力，需要在网络演算之外
        引入更丰富的合同描述语言。
      </p>

      {/* ============ 参考文献 ============ */}
      <h2>参考文献</h2>
      <ol className="blog-references">
        <li>
          J. S. Turner, “New directions in communications (or which way to the information age?),”
          <em>IEEE Communications Magazine</em>, vol. 24, no. 10, pp. 8–15, Oct. 1986.
        </li>
        <li>
          E. P. Rathgeb, “Modeling and performance comparison of policing mechanisms for ATM networks,”
          <em>IEEE Journal on Selected Areas in Communications</em>, vol. 9, no. 3, pp. 446–456, Apr. 1991.
        </li>
        <li>
          M. Buttò, E. Cavallero, A. Tonietti, “Effectiveness of the leaky bucket policing mechanism in ATM networks,”
          <em>IEEE Journal on Selected Areas in Communications</em>, vol. 9, no. 2, pp. 335–342, Feb. 1991.
        </li>
        <li>
          A. W. Berger, “Performance analysis of a rate-control throttle where tokens and jobs queue,”
          <em>IEEE Journal on Selected Areas in Communications</em>, vol. 9, no. 2, pp. 165–170, Feb. 1991.
        </li>
        <li>
          ITU-T Recommendation I.371, <em>Traffic control and congestion control in B-ISDN</em>,
          International Telecommunication Union.
        </li>
        <li>
          ATM Forum, <em>Traffic Management Specification Version 4.1</em>, af-tm-0121.000, Jul. 1999.
        </li>
        <li>
          J.-Y. Le Boudec and P. Thiran, <em>Network Calculus: A Theory of Deterministic Queuing Systems
          for the Internet</em>, LNCS 2050. Berlin: Springer, 2001.
        </li>
        <li>
          R. Fielding and M. Nottingham, “Additional HTTP Status Codes,” IETF RFC 6585, Apr. 2012.
        </li>
        <li>
          P. Tarjan, “Scaling your API with rate limiters,” Stripe Engineering Blog, Mar. 30, 2017.
          [Online]. Available: https://stripe.com/blog/rate-limiters
        </li>
        <li>
          J. Desgats, “How we built rate limiting capable of scaling to millions of domains,”
          Cloudflare Blog, Jun. 7, 2017. [Online]. Available: https://blog.cloudflare.com/counting-things-a-lot-of-different-things/
        </li>
        <li>
          Google, “Class RateLimiter,” Guava: Google Core Libraries for Java 23.0 API Documentation, 2017.
          [Online]. Available: https://guava.dev/releases/snapshot/api/docs/
        </li>
      </ol>
    </>
  );
}
