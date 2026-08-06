/* sports.js — sport category definitions: courts, formations & colors.
   Each sport provides:
     id, name {en, da}, icon (inline SVG string),
     court(ctx, W, H) — draws the playing surface,
     formation() — returns the default objects for a frame. */
const SPORTS = (() => {
  // ---- helpers ----
  function bg(ctx, W, H, c1, c2) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function frame(ctx, W, H) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);
  }
  function midline(ctx, W, H) {
    ctx.beginPath(); ctx.moveTo(8, H / 2); ctx.lineTo(W - 8, H / 2); ctx.stroke();
  }
  function centerCircle(ctx, W, H, r) {
    ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, 7); ctx.stroke();
  }
  // Mowed-grass horizontal stripes for a more realistic pitch.
  function grassStripes(ctx, W, H, c1, c2, n) {
    n = n || 10;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.fillRect(8, 8 + (H - 16) * i / n, W - 16, (H - 16) / n + 1);
    }
  }
  function team(objs, list, tkey, prefix) {
    list.forEach((c, i) => objs.push({ id: prefix + i, kind: 'player', team: tkey, label: i + 1, x: c[0], y: c[1] }));
  }
  // Rounded-rectangle path (for hockey/floorball rink boards).
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Authentic handball goal-area "D": a quarter-circle of radius R around each
  // goalpost joined by a straight top line — noticeably wider on both sides than
  // a plain semicircle. dir = 1 for the top goal (bulging down into the court),
  // dir = -1 for the bottom goal. Builds a path; the caller fills / strokes it.
  function handballArea(ctx, W, goalY, dir, postHalf, R) {
    const cx = W / 2, L = cx - postHalf, Rp = cx + postHalf;
    ctx.beginPath();
    for (let a = 180; a >= 90; a -= 6) {           // left quarter circle
      const t = a * Math.PI / 180, x = L + R * Math.cos(t), y = goalY + dir * R * Math.sin(t);
      a === 180 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(Rp, goalY + dir * R);               // straight top between the posts
    for (let a = 90; a >= 0; a -= 6) {             // right quarter circle
      const t = a * Math.PI / 180;
      ctx.lineTo(Rp + R * Math.cos(t), goalY + dir * R * Math.sin(t));
    }
  }

  // ---- individual court renderers ----
  const courts = {
    handball(ctx, W, H) {
      bg(ctx, W, H, '#1d64a8', '#2b7bc4'); frame(ctx, W, H); midline(ctx, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      const postHalf = 35, R6 = 132, R9 = 178;
      for (const yBase of [8, H - 8]) {
        const dir = yBase === 8 ? 1 : -1;
        // filled 6m goal area (wide D: quarter circles at the posts + flat top)
        ctx.fillStyle = 'rgba(255,255,255,.10)';
        handballArea(ctx, W, yBase, dir, postHalf, R6); ctx.fill();
        // 6m goal-area line
        ctx.lineWidth = 2;
        handballArea(ctx, W, yBase, dir, postHalf, R6); ctx.stroke();
        // 9m dashed free-throw line
        ctx.setLineDash([7, 6]);
        handballArea(ctx, W, yBase, dir, postHalf, R9); ctx.stroke(); ctx.setLineDash([]);
        // 7m penalty mark
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(W / 2 - 10, yBase + dir * 150, 20, 2);
        // goal
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(W / 2 - postHalf, yBase === 8 ? 4 : H - 12, postHalf * 2, 8);
      }
    },
    soccer(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#159a45'); grassStripes(ctx, W, H, '#0f6a31', '#14893f', 12);
      frame(ctx, W, H); midline(ctx, W, H); centerCircle(ctx, W, H, 60);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, 7); ctx.fill();
      // penalty + goal areas both ends
      ctx.strokeRect(W / 2 - 90, 8, 180, 60); ctx.strokeRect(W / 2 - 45, 8, 90, 28);
      ctx.strokeRect(W / 2 - 90, H - 68, 180, 60); ctx.strokeRect(W / 2 - 45, H - 36, 90, 28);
      // penalty arcs
      ctx.beginPath(); ctx.arc(W / 2, 78, 34, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H - 78, 34, 1.25 * Math.PI, 1.75 * Math.PI); ctx.stroke();
      ctx.fillStyle = '#ffd400';
      ctx.fillRect(W / 2 - 30, 4, 60, 6); ctx.fillRect(W / 2 - 30, H - 10, 60, 6);
    },
    basketball(ctx, W, H) {
      bg(ctx, W, H, '#a5642e', '#c17a3a');
      // subtle floorboards
      ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 1;
      for (let x = 22; x < W - 8; x += 26) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, H - 8); ctx.stroke(); }
      frame(ctx, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      midline(ctx, W, H); centerCircle(ctx, W, H, 54); centerCircle(ctx, W, H, 20);
      for (const yBase of [8, H - 8]) {
        const dir = yBase === 8 ? 1 : -1;
        const keyH = 150, keyW = 110, keyTop = yBase === 8 ? 8 : H - 8 - keyH;
        // painted key
        ctx.fillStyle = 'rgba(255,138,61,.32)';
        ctx.fillRect(W / 2 - keyW / 2, keyTop, keyW, keyH);
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.strokeRect(W / 2 - keyW / 2, keyTop, keyW, keyH);
        // free-throw circle
        ctx.beginPath(); ctx.arc(W / 2, yBase + dir * keyH, 46, 0, 7); ctx.stroke();
        // three-point arc
        ctx.beginPath(); ctx.arc(W / 2, yBase + dir * 30, 212, dir === 1 ? 0.13 * Math.PI : 1.13 * Math.PI, dir === 1 ? 0.87 * Math.PI : 1.87 * Math.PI); ctx.stroke();
        // backboard + rim
        ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(W / 2 - 28, yBase + dir * 12); ctx.lineTo(W / 2 + 28, yBase + dir * 12); ctx.stroke();
        ctx.beginPath(); ctx.arc(W / 2, yBase + dir * 24, 9, 0, 7); ctx.stroke();
        // restricted-area arc
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(W / 2, yBase + dir * 24, 30, dir === 1 ? 0 : Math.PI, dir === 1 ? Math.PI : Math.PI * 2); ctx.stroke();
      }
    },
    tennis(ctx, W, H) {
      // Top-down hard court: doubles box, singles tramlines, service boxes and net.
      bg(ctx, W, H, '#12557a', '#1a6b96'); frame(ctx, W, H);
      ctx.strokeStyle = '#fff';
      const mx = 34, my = 10;
      // doubles outer boundary
      ctx.lineWidth = 2; ctx.strokeRect(mx, my, W - 2 * mx, H - 2 * my);
      // singles sidelines (tramlines)
      const sx = mx + 28;
      ctx.beginPath(); ctx.moveTo(sx, my); ctx.lineTo(sx, H - my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W - sx, my); ctx.lineTo(W - sx, H - my); ctx.stroke();
      // net across the middle
      ctx.lineWidth = 4; midline(ctx, W, H); ctx.lineWidth = 2;
      // service lines
      const svcTop = H / 2 - (H / 2 - my) * 0.52, svcBot = H / 2 + (H / 2 - my) * 0.52;
      ctx.beginPath(); ctx.moveTo(sx, svcTop); ctx.lineTo(W - sx, svcTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, svcBot); ctx.lineTo(W - sx, svcBot); ctx.stroke();
      // centre service line + baseline centre marks
      ctx.beginPath(); ctx.moveTo(W / 2, svcTop); ctx.lineTo(W / 2, svcBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2, my); ctx.lineTo(W / 2, my + 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2, H - my); ctx.lineTo(W / 2, H - my - 9); ctx.stroke();
    },
    volleyball(ctx, W, H) {
      bg(ctx, W, H, '#b5651d', '#d2792b'); frame(ctx, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; midline(ctx, W, H); ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(8, H / 2 - 60); ctx.lineTo(W - 8, H / 2 - 60); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, H / 2 + 60); ctx.lineTo(W - 8, H / 2 + 60); ctx.stroke();
      ctx.setLineDash([]);
    },
    baseball(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#127a37');
      ctx.fillStyle = '#b5651d';
      ctx.beginPath(); ctx.moveTo(W / 2, H - 40); ctx.lineTo(W - 60, H / 2); ctx.lineTo(W / 2, 60); ctx.lineTo(60, H / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H - 40, 90, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const [x, y] of [[W / 2, H - 40], [W - 60, H / 2], [W / 2, 60], [60, H / 2]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore(); }
    },
    rugby(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#159a45'); grassStripes(ctx, W, H, '#0f6a31', '#14893f', 10);
      frame(ctx, W, H); midline(ctx, W, H);
      // in-goal shading behind each try line
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(8, 8, W - 16, 32); ctx.fillRect(8, H - 40, W - 16, 32);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      for (const y of [40, H - 40]) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke(); }   // try lines
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5;
      for (const y of [H / 2 - 60, H / 2 + 60]) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke(); }  // 22m lines
      ctx.setLineDash([]);
      // H-shaped goalposts straddling each try line
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const post = (y, dir) => {
        const cx = W / 2, w = 34, bar = y + dir * 16;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, y - dir * 8); ctx.lineTo(cx - w / 2, bar + dir * 22);
        ctx.moveTo(cx + w / 2, y - dir * 8); ctx.lineTo(cx + w / 2, bar + dir * 22);
        ctx.moveTo(cx - w / 2, bar); ctx.lineTo(cx + w / 2, bar);
        ctx.stroke();
      };
      post(40, -1); post(H - 40, 1);
      ctx.lineCap = 'butt';
    },
    football(ctx, W, H) { // American football
      bg(ctx, W, H, '#0d5c2b', '#127a37');
      // subtle turf stripes down the field
      for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.05)'; ctx.fillRect(8 + (W - 16) * i / 10, 8, (W - 16) / 10 + 1, H - 16); }
      frame(ctx, W, H);
      // end zones
      ctx.fillStyle = 'rgba(255,106,0,.30)';
      ctx.fillRect(8, 8, W - 16, 46); ctx.fillRect(8, H - 54, W - 16, 46);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(8, 54, W - 16, H - 108);            // goal lines
      // yard lines + hash marks every 10 yards
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const y = 54 + (H - 108) * i / 10;
        ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
        ctx.beginPath();
        for (const hx of [W * 0.35, W * 0.65]) { ctx.moveTo(hx - 4, y); ctx.lineTo(hx + 4, y); }
        ctx.stroke();
      }
      // yard numbers down both sidelines
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const nums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
      for (let i = 1; i < 10; i++) { const y = 54 + (H - 108) * i / 10; ctx.fillText(nums[i - 1], 30, y); ctx.fillText(nums[i - 1], W - 30, y); }
      // goalposts (field goals) at each end
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const post = (yBack, dir) => {
        const cx = W / 2, cross = yBack + dir * 18, span = 48;
        ctx.beginPath();
        ctx.moveTo(cx, yBack); ctx.lineTo(cx, cross);
        ctx.moveTo(cx - span / 2, cross); ctx.lineTo(cx + span / 2, cross);
        ctx.moveTo(cx - span / 2, cross); ctx.lineTo(cx - span / 2, cross + dir * 26);
        ctx.moveTo(cx + span / 2, cross); ctx.lineTo(cx + span / 2, cross + dir * 26);
        ctx.stroke();
      };
      post(12, 1); post(H - 12, -1);
      ctx.lineCap = 'butt';
    },
    badminton(ctx, W, H) {
      bg(ctx, W, H, '#0a5c66', '#0c7580'); frame(ctx, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; midline(ctx, W, H); ctx.lineWidth = 1.5;
      ctx.strokeRect(30, 8, W - 60, H - 16);
      ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 8); ctx.stroke();
      for (const y of [H / 2 - 40, H / 2 + 40]) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 30, y); ctx.stroke(); }
    },
    snooker(ctx, W, H) {
      // wooden surround
      ctx.fillStyle = '#5a3418'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3f2410'; ctx.fillRect(18, 18, W - 36, H - 36);
      // baize
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f7a38'); g.addColorStop(1, '#0b6630');
      ctx.fillStyle = g; ctx.fillRect(34, 34, W - 68, H - 68);
      // pockets: 4 corners + 2 mid (long vertical sides)
      const pockets = [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34], [34, H / 2], [W - 34, H / 2]];
      ctx.fillStyle = '#04140a';
      pockets.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill(); });
      // baulk line + D near bottom
      const baulkY = H - 34 - (H - 68) * 0.2;
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(34, baulkY); ctx.lineTo(W - 34, baulkY); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, baulkY, 46, Math.PI, 2 * Math.PI); ctx.stroke();
      // spots (pink & blue & black)
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      [[W / 2, 34 + (H - 68) * 0.18], [W / 2, H / 2], [W / 2, baulkY]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); });
    },
    pool(ctx, W, H) {
      ctx.fillStyle = '#3a2410'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(20, 20, W - 40, H - 40);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#12557a'); g.addColorStop(1, '#0e4767');
      ctx.fillStyle = g; ctx.fillRect(34, 34, W - 68, H - 68);
      const pockets = [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34], [34, H / 2], [W - 34, H / 2]];
      ctx.fillStyle = '#000';
      pockets.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill(); });
      // head string + foot spot
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.2;
      const headY = H - 34 - (H - 68) * 0.25;
      ctx.beginPath(); ctx.moveTo(34, headY); ctx.lineTo(W - 34, headY); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(W / 2, 34 + (H - 68) * 0.25, 2, 0, 7); ctx.fill();
    },
    darts(ctx, W, H) {
      ctx.fillStyle = '#0b0f1a'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 34, num = 20;
      const seg = (r0, r1, i, colA, colB) => {
        const a0 = (i / num) * 2 * Math.PI - Math.PI / 2 - Math.PI / num, a1 = a0 + 2 * Math.PI / num;
        ctx.beginPath(); ctx.arc(cx, cy, r1, a0, a1); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
        ctx.fillStyle = i % 2 ? colA : colB; ctx.fill();
      };
      for (let i = 0; i < num; i++) seg(R * 0.16, R, i, '#1c1c1c', '#e9d6a8');       // main segments
      for (let i = 0; i < num; i++) seg(R * 0.62, R * 0.68, i, '#c81026', '#12833a'); // treble ring
      for (let i = 0; i < num; i++) seg(R * 0.94, R, i, '#c81026', '#12833a');         // double ring
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, 7); ctx.fillStyle = '#12833a'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.07, 0, 7); ctx.fillStyle = '#c81026'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
      for (let i = 0; i < num; i++) { const a = (i / num) * 2 * Math.PI - Math.PI / 2; ctx.fillText(order[i], cx + Math.cos(a) * (R + 18), cy + Math.sin(a) * (R + 18)); }
    },
    icehockey(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#eef5fc'); g.addColorStop(1, '#d9e9f8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const m = 12, rad = 64;
      roundRectPath(ctx, m, m, W - 2 * m, H - 2 * m, rad);
      ctx.strokeStyle = 'rgba(20,50,80,.55)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.clip();
      // blue lines
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 6;
      [H / 2 - H * 0.17, H / 2 + H * 0.17].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
      // center red line
      ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      // goal lines
      ctx.lineWidth = 2;
      [m + 34, H - m - 34].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
      ctx.restore();
      // center faceoff
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, H / 2, 46, 0, 7); ctx.stroke();
      ctx.fillStyle = '#1d4ed8'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, 7); ctx.fill();
      // zone faceoff circles + dots
      ctx.strokeStyle = '#e11d48'; ctx.fillStyle = '#e11d48'; ctx.lineWidth = 1.5;
      for (const y of [H / 2 - H * 0.29, H / 2 + H * 0.29]) for (const x of [W / 2 - 95, W / 2 + 95]) {
        ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      }
      // goal creases + goals (bigger nets)
      for (const yb of [m + 34, H - m - 34]) {
        const dir = yb < H / 2 ? 1 : -1;
        ctx.fillStyle = 'rgba(29,78,216,.30)';
        ctx.beginPath(); ctx.arc(W / 2, yb, 34, dir === 1 ? 0 : Math.PI, dir === 1 ? Math.PI : 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(W / 2, yb, 34, dir === 1 ? 0 : Math.PI, dir === 1 ? Math.PI : 2 * Math.PI); ctx.stroke();
        const gw = 64, gd = 22, gx = W / 2 - gw / 2, gy = dir === 1 ? yb - gd : yb;
        ctx.fillStyle = 'rgba(225,29,72,.20)'; ctx.fillRect(gx, gy, gw, gd);
        ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 3; ctx.strokeRect(gx, gy, gw, gd);
        ctx.strokeStyle = 'rgba(225,29,72,.45)'; ctx.lineWidth = 1;
        for (let x = gx + 8; x < gx + gw; x += 8) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gd); ctx.stroke(); }
        for (let yy = gy + 7; yy < gy + gd; yy += 7) { ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke(); }
      }
    },
    floorball(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a6df0'); g.addColorStop(1, '#1f57c9');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const m = 12, rad = 46;
      roundRectPath(ctx, m, m, W - 2 * m, H - 2 * m, rad);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 44, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, 7); ctx.fill();
      // goalkeeper areas + goals both ends
      for (const top of [true, false]) {
        const areaY = top ? m + 14 : H - m - 14 - 46;
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
        ctx.strokeRect(W / 2 - 60, areaY, 120, 46);
        ctx.fillStyle = '#ffd400'; ctx.fillRect(W / 2 - 22, top ? m + 2 : H - m - 8, 44, 6);
      }
    },
    chess(ctx, W, H) {
      // 8×8 board filling the canvas so piece percentages align exactly with squares.
      const light = '#eadfc8', dark = '#9a6b41';
      const cw = W / 8, ch = H / 8;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? light : dark;
        ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
      }
      // frame
      ctx.strokeStyle = 'rgba(20,12,4,.7)'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
      // file/rank coordinates — draw each label in the OPPOSITE colour of the
      // square it sits on so it always stays readable (a1 dark → light letters).
      const files = 'abcdefgh';
      ctx.font = 'bold 11px system-ui'; ctx.textBaseline = 'alphabetic';
      for (let c = 0; c < 8; c++) {
        // file letters sit on the bottom rank (row 7): light square when c is odd
        ctx.fillStyle = ((7 + c) % 2 === 0) ? dark : light;
        ctx.textAlign = 'left'; ctx.fillText(files[c], c * cw + 3, H - 4);
      }
      for (let r = 0; r < 8; r++) {
        // rank numbers sit on the right file (col 7): light square when r is odd
        ctx.fillStyle = ((r + 7) % 2 === 0) ? dark : light;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(String(8 - r), W - 3, r * ch + 2);
      }
    },
    bridge(ctx, W, H) {
      // Card table: dark surround + green felt with four compass seats.
      const g0 = ctx.createLinearGradient(0, 0, 0, H); g0.addColorStop(0, '#243b6b'); g0.addColorStop(1, '#16274a');
      ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
      const m = 30;
      roundRectPath(ctx, m, m, W - 2 * m, H - 2 * m, 44);
      const g = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, Math.max(W, H) / 1.3);
      g.addColorStop(0, '#1f8a4c'); g.addColorStop(1, '#12603a');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#0b3d22'; ctx.lineWidth = 6; ctx.stroke();
      // central trick zone
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5;
      roundRectPath(ctx, W / 2 - 46, H / 2 - 58, 92, 116, 10); ctx.stroke();
      // compass rose
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 9, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 16); ctx.lineTo(W / 2, H / 2 + 16);
      ctx.moveTo(W / 2 - 16, H / 2); ctx.lineTo(W / 2 + 16, H / 2); ctx.stroke();
      // seat labels
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = 'bold 16px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', W / 2, m + 14);
      ctx.fillText('S', W / 2, H - m - 14);
      ctx.fillText('W', m + 14, H / 2);
      ctx.fillText('E', W - m - 14, H / 2);
    },
    poker(ctx, W, H) {
      // Green oval poker table with felt, rail and a community-card row.
      ctx.fillStyle = '#241611'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, rx = W / 2 - 24, ry = H / 2 - 34;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fillStyle = '#5a3a1e'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx - 16, ry - 16, 0, 0, 7);
      const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, '#1f8a4c'); g.addColorStop(1, '#0f5e33');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) { const x = cx - 92 + i * 45; roundRectPath(ctx, x, cy - 26, 34, 46, 5); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('POT', cx, cy + 40);
    },
    backgammon(ctx, W, H) {
      // Classic board: two halves of 12 triangular points split by a central bar.
      ctx.fillStyle = '#2a1808'; ctx.fillRect(0, 0, W, H);
      const m = 14, barW = 26, boardW = W - 2 * m, half = (boardW - barW) / 2, ptW = half / 6;
      ctx.fillStyle = '#c9a26b'; ctx.fillRect(m, m, boardW, H - 2 * m);
      const barX = m + half;
      const drawPts = (x0) => {
        for (let i = 0; i < 6; i++) {
          const x = x0 + i * ptW;
          ctx.fillStyle = i % 2 ? '#7a4a24' : '#e6cfa8';
          ctx.beginPath(); ctx.moveTo(x, m); ctx.lineTo(x + ptW, m); ctx.lineTo(x + ptW / 2, H / 2 - 6); ctx.closePath(); ctx.fill();
          ctx.fillStyle = i % 2 ? '#e6cfa8' : '#7a4a24';
          ctx.beginPath(); ctx.moveTo(x, H - m); ctx.lineTo(x + ptW, H - m); ctx.lineTo(x + ptW / 2, H / 2 + 6); ctx.closePath(); ctx.fill();
        }
      };
      drawPts(m); drawPts(barX + barW);
      ctx.fillStyle = '#4a2f16'; ctx.fillRect(barX, m, barW, H - 2 * m);
      ctx.strokeStyle = '#1c1206'; ctx.lineWidth = 4; ctx.strokeRect(m, m, boardW, H - 2 * m);
    }
  };

  // ---- half-court renderers (team sports) ----
  // Draws the attacking half only: the goal / basket sits at the TOP and the
  // halfway line runs along the BOTTOM edge. Every renderer is authored to fill
  // the whole canvas at a true 1:1 scale, so — unlike a stretched full court —
  // players, the ball and all arcs stay perfectly round and correctly aligned.
  function halfMid(ctx, W, H, r) {
    // halfway line along the bottom edge + a real centre-circle arc bulging up
    ctx.beginPath(); ctx.moveTo(8, H - 8); ctx.lineTo(W - 8, H - 8); ctx.stroke();
    if (r) { ctx.beginPath(); ctx.arc(W / 2, H - 8, r, Math.PI, 2 * Math.PI); ctx.stroke(); }
  }
  const halfCourts = {
    handball(ctx, W, H) {
      bg(ctx, W, H, '#1d64a8', '#2b7bc4'); frame(ctx, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      halfMid(ctx, W, H, 66);
      const gy = 12, postHalf = 46, R6 = 196, R9 = 280;
      // 6m goal area (wide D) + solid line
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      handballArea(ctx, W, gy, 1, postHalf, R6); ctx.fill();
      handballArea(ctx, W, gy, 1, postHalf, R6); ctx.stroke();
      // 9m dashed free-throw line
      ctx.setLineDash([8, 7]);
      handballArea(ctx, W, gy, 1, postHalf, R9); ctx.stroke();
      ctx.setLineDash([]);
      // 7m penalty mark
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(W / 2 - 12, gy + 226, 24, 3);
      // goal mouth
      ctx.fillStyle = '#ffd400'; ctx.fillRect(W / 2 - postHalf, 6, postHalf * 2, 9);
    },
    soccer(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#159a45'); grassStripes(ctx, W, H, '#0f6a31', '#14893f', 10);
      frame(ctx, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      halfMid(ctx, W, H, 70);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(W / 2, H - 8, 3, 0, 7); ctx.fill();
      // penalty box + goal area at the top
      ctx.strokeRect(W / 2 - 135, 8, 270, 96);
      ctx.strokeRect(W / 2 - 66, 8, 132, 42);
      // penalty spot + arc
      ctx.fillRect(W / 2 - 2, 70, 4, 4);
      ctx.beginPath(); ctx.arc(W / 2, 70, 50, 0.10 * Math.PI, 0.90 * Math.PI); ctx.stroke();
      // goal mouth
      ctx.fillStyle = '#ffd400'; ctx.fillRect(W / 2 - 42, 4, 84, 7);
    },
    basketball(ctx, W, H) {
      bg(ctx, W, H, '#a5642e', '#c17a3a');
      ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 1;
      for (let x = 22; x < W - 8; x += 26) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, H - 8); ctx.stroke(); }
      frame(ctx, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      halfMid(ctx, W, H, 60);
      const keyW = 150, keyH = 200, keyTop = 8;
      ctx.fillStyle = 'rgba(255,138,61,.32)'; ctx.fillRect(W / 2 - keyW / 2, keyTop, keyW, keyH);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeRect(W / 2 - keyW / 2, keyTop, keyW, keyH);
      // free-throw circle
      ctx.beginPath(); ctx.arc(W / 2, keyTop + keyH, 58, 0, 7); ctx.stroke();
      // three-point arc
      ctx.beginPath(); ctx.arc(W / 2, 58, 250, 0.13 * Math.PI, 0.87 * Math.PI); ctx.stroke();
      // backboard + rim
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W / 2 - 40, 26); ctx.lineTo(W / 2 + 40, 26); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, 42, 12, 0, 7); ctx.stroke();
      // restricted-area arc
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(W / 2, 42, 40, 0, Math.PI); ctx.stroke();
    },
    volleyball(ctx, W, H) {
      bg(ctx, W, H, '#b5651d', '#d2792b'); frame(ctx, W, H);
      ctx.strokeStyle = '#fff';
      // net along the top edge
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(W - 8, 10); ctx.stroke();
      // attack (3m) line
      ctx.lineWidth = 2; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.moveTo(8, H * 0.44); ctx.lineTo(W - 8, H * 0.44); ctx.stroke();
      ctx.setLineDash([]);
    },
    baseball(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#127a37');
      const midY = (H - 60 + 80) / 2;
      const home = [W / 2, H - 60], second = [W / 2, 80], first = [W - 110, midY], third = [110, midY];
      ctx.fillStyle = '#b5651d';
      ctx.beginPath(); ctx.moveTo(home[0], home[1]); ctx.lineTo(first[0], first[1]); ctx.lineTo(second[0], second[1]); ctx.lineTo(third[0], third[1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      // infield grass arc behind home
      ctx.beginPath(); ctx.arc(home[0], home[1], 150, Math.PI, 2 * Math.PI); ctx.stroke();
      // pitcher's mound
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.arc(W / 2, H / 2 - 5, 18, 0, 7); ctx.fill();
      // bases
      ctx.fillStyle = '#fff';
      [home, first, second, third].forEach(([x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-8, -8, 16, 16); ctx.restore(); });
    },
    rugby(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#159a45'); grassStripes(ctx, W, H, '#0f6a31', '#14893f', 10);
      frame(ctx, W, H);
      // in-goal shading + try line near the top
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(8, 8, W - 16, 46);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 54); ctx.lineTo(W - 8, 54); ctx.stroke();
      // 22m line (dashed)
      ctx.setLineDash([7, 7]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8, H * 0.52); ctx.lineTo(W - 8, H * 0.52); ctx.stroke();
      ctx.setLineDash([]);
      // halfway line (bottom)
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, H - 8); ctx.lineTo(W - 8, H - 8); ctx.stroke();
      // H-shaped goalposts on the try line
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const cx = W / 2, gw = 44;
      ctx.beginPath();
      ctx.moveTo(cx - gw / 2, 74); ctx.lineTo(cx - gw / 2, 30);
      ctx.moveTo(cx + gw / 2, 74); ctx.lineTo(cx + gw / 2, 30);
      ctx.moveTo(cx - gw / 2, 44); ctx.lineTo(cx + gw / 2, 44);
      ctx.stroke(); ctx.lineCap = 'butt';
    },
    football(ctx, W, H) {
      bg(ctx, W, H, '#0d5c2b', '#127a37');
      for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.05)'; ctx.fillRect(8 + (W - 16) * i / 10, 8, (W - 16) / 10 + 1, H - 16); }
      frame(ctx, W, H);
      // end zone at the top
      ctx.fillStyle = 'rgba(255,106,0,.30)'; ctx.fillRect(8, 8, W - 16, 58);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 66); ctx.lineTo(W - 8, 66); ctx.stroke();     // goal line
      // yard lines + hash marks from goal line down to halfway (bottom)
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
      const top = 66, bot = H - 8;
      for (let i = 1; i <= 5; i++) {
        const y = top + (bot - top) * i / 5;
        ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
        ctx.beginPath(); for (const hx of [W * 0.36, W * 0.64]) { ctx.moveTo(hx - 5, y); ctx.lineTo(hx + 5, y); } ctx.stroke();
      }
      // goalpost at the back of the end zone
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const cx = W / 2, cross = 30, span = 54;
      ctx.beginPath();
      ctx.moveTo(cx, 10); ctx.lineTo(cx, cross);
      ctx.moveTo(cx - span / 2, cross); ctx.lineTo(cx + span / 2, cross);
      ctx.moveTo(cx - span / 2, cross); ctx.lineTo(cx - span / 2, cross + 22);
      ctx.moveTo(cx + span / 2, cross); ctx.lineTo(cx + span / 2, cross + 22);
      ctx.stroke(); ctx.lineCap = 'butt';
    },
    icehockey(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#eef5fc'); g.addColorStop(1, '#d9e9f8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const m = 12, rad = 60;
      roundRectPath(ctx, m, m, W - 2 * m, H - 2 * m, rad);
      ctx.strokeStyle = 'rgba(20,50,80,.55)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.clip();
      // goal line near the top
      ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 54); ctx.lineTo(W, 54); ctx.stroke();
      // blue line lower down
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, H * 0.66); ctx.lineTo(W, H * 0.66); ctx.stroke();
      // centre red line along the bottom (halfway)
      ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, H - 10); ctx.lineTo(W, H - 10); ctx.stroke();
      ctx.restore();
      // zone faceoff circles + dots
      ctx.strokeStyle = '#e11d48'; ctx.fillStyle = '#e11d48'; ctx.lineWidth = 1.5;
      for (const x of [W / 2 - 120, W / 2 + 120]) {
        ctx.beginPath(); ctx.arc(x, H * 0.42, 46, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, H * 0.42, 4, 0, 7); ctx.fill();
      }
      // goal crease + net at the top
      const yb = 54;
      ctx.fillStyle = 'rgba(29,78,216,.30)'; ctx.beginPath(); ctx.arc(W / 2, yb, 40, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, yb, 40, 0, Math.PI); ctx.stroke();
      const gw = 76, gd = 26, gx = W / 2 - gw / 2, gyt = yb - gd;
      ctx.fillStyle = 'rgba(225,29,72,.20)'; ctx.fillRect(gx, gyt, gw, gd);
      ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 3; ctx.strokeRect(gx, gyt, gw, gd);
    },
    floorball(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a6df0'); g.addColorStop(1, '#1f57c9');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const m = 12, rad = 44;
      roundRectPath(ctx, m, m, W - 2 * m, H - 2 * m, rad);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.clip();
      // halfway line along the bottom + centre arc
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, H - 10); ctx.lineTo(W, H - 10); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H - 10, 44, Math.PI, 2 * Math.PI); ctx.stroke();
      ctx.restore();
      // goalkeeper area + goal at the top
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 80, 40, 160, 70);
      ctx.strokeRect(W / 2 - 44, 20, 88, 40);
      ctx.fillStyle = '#ffd400'; ctx.fillRect(W / 2 - 26, 14, 52, 7);
    }
  };

  // ---- default formations ----
  function withBallGk(objs, ballY) {
    objs.push({ id: 'gk', kind: 'gk', team: 'def', label: 'GK', x: 50, y: 12 });
    objs.push({ id: 'ball', kind: 'ball', x: 50, y: ballY });
    return objs;
  }
  const formations = {
    handball() {
      const o = [];
      // Defenders (red): flat 6-0 wall standing along the widened 6 m goal-area
      // curve. Each is turned outward to face the attacker in its channel (rot,
      // radians, 0 = pointing right, +y = down — matching canvas screen space).
      const def = [
        [26.44, 14.82, 2.715], [38.37, 26.89, 2.091], [47.57, 28.21, 1.684],
        [52.43, 28.21, 1.458], [61.63, 26.89, 1.051], [73.56, 14.82, 0.426]
      ];
      def.forEach((c, i) => o.push({ id: 'd' + i, kind: 'player', team: 'def', label: i + 1, x: c[0], y: c[1], rot: c[2] }));
      // Attackers (blue): one opposite each defender, each turned to face the red
      // player it is up against (rot points back toward that defender).
      const atk = [
        [17.09, 20.14, -0.426], [33.27, 38.05, -1.051], [46.41, 40.98, -1.458],
        [53.59, 40.98, -1.684], [66.73, 38.05, -2.091], [82.91, 20.14, -2.715]
      ];
      atk.forEach((c, i) => o.push({ id: 'a' + i, kind: 'player', team: 'atk', label: i + 1, x: c[0], y: c[1], rot: c[2] }));
      return withBallGk(o, 46);
    },
    soccer() {
      const o = [];
      team(o, [[50, 90], [25, 78], [42, 72], [58, 72], [75, 78], [35, 60], [65, 60], [50, 55], [30, 45], [70, 45], [50, 38]], 'atk', 'a');
      team(o, [[50, 25], [30, 20], [70, 20], [42, 32], [58, 32]], 'def', 'd');
      return withBallGk(o, 82);
    },
    basketball() {
      const o = [];
      team(o, [[50, 82], [28, 70], [72, 70], [38, 55], [62, 55]], 'atk', 'a');
      team(o, [[50, 30], [35, 40], [65, 40], [42, 22], [58, 22]], 'def', 'd');
      return withBallGk(o, 78);
    },
    tennis() {
      const o = [];
      o.push({ id: 'a0', kind: 'player', team: 'atk', label: 1, x: 50, y: 80 });
      o.push({ id: 'd0', kind: 'player', team: 'def', label: 2, x: 50, y: 20 });
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 50 });
      return o;
    },
    volleyball() {
      const o = [];
      team(o, [[30, 78], [50, 88], [70, 78], [30, 60], [50, 58], [70, 60]], 'atk', 'a');
      team(o, [[30, 22], [50, 12], [70, 22], [30, 40], [50, 42], [70, 40]], 'def', 'd');
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 50 });
      return o;
    },
    baseball() {
      const o = [];
      team(o, [[50, 60], [50, 82], [70, 58], [30, 58], [30, 38], [70, 38], [50, 32], [40, 45], [60, 45]], 'def', 'd');
      o.push({ id: 'a0', kind: 'player', team: 'atk', label: 'B', x: 50, y: 80 });
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 60 });
      return o;
    },
    rugby() {
      const o = [];
      team(o, [[50, 85], [35, 78], [65, 78], [20, 70], [80, 70], [40, 65], [60, 65], [50, 60]], 'atk', 'a');
      team(o, [[50, 40], [35, 35], [65, 35], [25, 45], [75, 45], [50, 48]], 'def', 'd');
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 83 });
      return o;
    },
    football() {
      const o = [];
      team(o, [[50, 78], [30, 72], [40, 72], [60, 72], [70, 72], [50, 68], [50, 85]], 'atk', 'a');
      team(o, [[30, 55], [40, 55], [50, 55], [60, 55], [70, 55], [50, 45]], 'def', 'd');
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 82 });
      return o;
    },
    badminton() {
      const o = [];
      o.push({ id: 'a0', kind: 'player', team: 'atk', label: 1, x: 50, y: 78 });
      o.push({ id: 'd0', kind: 'player', team: 'def', label: 2, x: 50, y: 22 });
      o.push({ id: 'ball', kind: 'ball', x: 50, y: 50 });
      return o;
    },
    snooker() {
      const o = [];
      const ball = (id, x, y, color, label) => o.push({ id, kind: 'cue', color, label: label || '', x, y });
      // colours on their spots
      ball('yellow', 36, 80, '#ffd400'); ball('green', 64, 80, '#159a45'); ball('brown', 50, 80, '#7a4a1e');
      ball('blue', 50, 50, '#0a84ff'); ball('pink', 50, 27, '#ff7ab0'); ball('black', 50, 15, '#101418');
      // reds triangle below pink
      const reds = [[50, 31], [46, 35], [54, 35], [42, 39], [50, 39], [58, 39], [38, 43], [46, 43], [54, 43], [62, 43]];
      reds.forEach((c, i) => ball('r' + i, c[0], c[1], '#c81026'));
      // cue ball in the D
      ball('cue', 50, 85, '#f4f4ef');
      return o;
    },
    pool() {
      const o = [];
      const ball = (id, x, y, color, label) => o.push({ id, kind: 'cue', color, label: label || '', x, y });
      const rack = [
        [50, 24, '#ffd400', '1'],
        [46, 29, '#0a84ff', '2'], [54, 29, '#c81026', '3'],
        [42, 34, '#7a2bff', '4'], [50, 34, '#101418', '8'], [58, 34, '#ff8a1e', '5'],
        [38, 39, '#159a45', '6'], [46, 39, '#7a4a1e', '7'], [54, 39, '#ffd400', '9'], [62, 39, '#0a84ff', '10'],
        [34, 44, '#c81026', '11'], [42, 44, '#7a2bff', '12'], [50, 44, '#ff8a1e', '13'], [58, 44, '#159a45', '14'], [66, 44, '#7a4a1e', '15']
      ];
      rack.forEach((c, i) => ball('p' + i, c[0], c[1], c[2], c[3]));
      ball('cue', 50, 80, '#f4f4ef');
      return o;
    },
    darts() {
      return [
        { id: 'd1', kind: 'dart', color: '#c81026', x: 50, y: 50 },
        { id: 'd2', kind: 'dart', color: '#0a84ff', x: 57, y: 41 },
        { id: 'd3', kind: 'dart', color: '#ffd400', x: 43, y: 59 }
      ];
    },
    icehockey() {
      const o = [];
      team(o, [[50, 82], [30, 72], [70, 72], [40, 60], [60, 60]], 'atk', 'a');
      team(o, [[35, 34], [65, 34], [45, 44], [55, 44], [50, 26]], 'def', 'd');
      return withBallGk(o, 78);
    },
    floorball() {
      const o = [];
      team(o, [[50, 82], [28, 70], [72, 70], [40, 58], [60, 58]], 'atk', 'a');
      team(o, [[35, 34], [65, 34], [45, 44], [55, 44]], 'def', 'd');
      return withBallGk(o, 78);
    },
    chess() {
      // Standard starting position on the 8×8 grid (atk = white, def = black).
      const o = [];
      const cx = c => (c + 0.5) * 12.5, cy = r => (r + 0.5) * 12.5;
      const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
      back.forEach((p, c) => o.push({ id: 'bb' + c, kind: 'piece', team: 'def', piece: p, label: p, x: cx(c), y: cy(0) }));
      for (let c = 0; c < 8; c++) o.push({ id: 'bp' + c, kind: 'piece', team: 'def', piece: 'P', label: 'P', x: cx(c), y: cy(1) });
      for (let c = 0; c < 8; c++) o.push({ id: 'wp' + c, kind: 'piece', team: 'atk', piece: 'P', label: 'P', x: cx(c), y: cy(6) });
      back.forEach((p, c) => o.push({ id: 'wb' + c, kind: 'piece', team: 'atk', piece: p, label: p, x: cx(c), y: cy(7) }));
      return o;
    },
    bridge() {
      // Four seats (N/S = one partnership, E/W = the other) + a sample trick.
      const o = [];
      o.push({ id: 'N', kind: 'player', team: 'atk', label: 'N', x: 50, y: 12 });
      o.push({ id: 'S', kind: 'player', team: 'atk', label: 'S', x: 50, y: 88 });
      o.push({ id: 'W', kind: 'player', team: 'def', label: 'W', x: 10, y: 50 });
      o.push({ id: 'E', kind: 'player', team: 'def', label: 'E', x: 90, y: 50 });
      o.push({ id: 'cN', kind: 'card', suit: '♠', label: 'A', x: 50, y: 41 });
      o.push({ id: 'cS', kind: 'card', suit: '♥', label: 'K', x: 50, y: 59 });
      o.push({ id: 'cW', kind: 'card', suit: '♦', label: 'Q', x: 41, y: 50 });
      o.push({ id: 'cE', kind: 'card', suit: '♣', label: 'J', x: 59, y: 50 });
      return o;
    },
    poker() {
      // Hero (South) + five opponents around the table, community cards + hole cards.
      const o = [];
      o.push({ id: 'p_you', kind: 'player', team: 'atk', label: 'You', x: 50, y: 86 });
      const seats = [['B1', 14, 62], ['B2', 20, 28], ['B3', 50, 14], ['B4', 80, 28], ['B5', 86, 62]];
      seats.forEach(([l, x, y]) => o.push({ id: 'p_' + l, kind: 'player', team: 'def', label: l, x, y }));
      [['A', '♠'], ['K', '♠'], ['Q', '♥'], ['J', '♦'], ['10', '♣']].forEach((c, i) => o.push({ id: 'cc' + i, kind: 'card', label: c[0], suit: c[1], x: 32 + i * 9, y: 45 }));
      o.push({ id: 'h1', kind: 'card', label: 'A', suit: '♥', x: 46, y: 71 });
      o.push({ id: 'h2', kind: 'card', label: 'K', suit: '♥', x: 54, y: 71 });
      return o;
    },
    backgammon() {
      // Standard starting checker layout across the 24 points.
      const o = [];
      const colX = c => c < 6 ? 7 + c * 7 : 58 + (c - 6) * 7;
      const pointCol = p => p <= 12 ? [11 - (p - 1), false] : [p - 13, true];
      const place = (p, n, team, tag) => {
        const [col, top] = pointCol(p), x = colX(col);
        for (let i = 0; i < n; i++) o.push({ id: tag + p + '_' + i, kind: 'checker', team, x, y: top ? 9 + i * 6 : 91 - i * 6 });
      };
      place(24, 2, 'atk', 'w'); place(13, 5, 'atk', 'w'); place(8, 3, 'atk', 'w'); place(6, 5, 'atk', 'w');
      place(1, 2, 'def', 'b'); place(12, 5, 'def', 'b'); place(17, 3, 'def', 'b'); place(19, 5, 'def', 'b');
      return o;
    }
  };

  // A generic half-court set (offensive half only) for team sports: the goal or
  // basket sits at the top, defenders near the mid line, attackers spread below.
  // Coordinates use the full 0–100 range so they map 1:1 onto the half court
  // canvas (no vertical stretch — players and the ball stay perfectly round).
  function halfFormation(id) {
    const full = formations[id] ? formations[id]() : [];
    const hasGk = full.some(o => o.kind === 'gk');
    const hasBall = full.some(o => o.kind === 'ball');
    const atk = full.filter(o => o.kind === 'player' && o.team === 'atk');
    const def = full.filter(o => o.kind === 'player' && o.team === 'def');
    const spread = (n, x0, x1) => {
      const out = []; if (n <= 0) return out;
      if (n === 1) { out.push((x0 + x1) / 2); return out; }
      for (let i = 0; i < n; i++) out.push(x0 + (x1 - x0) * i / (n - 1));
      return out;
    };
    const o = [];
    if (hasGk) o.push({ id: 'gk', kind: 'gk', team: 'def', label: 'GK', x: 50, y: 9, active: false });
    const dxs = spread(def.length, 26, 74);
    def.forEach((d, i) => o.push({ id: d.id, kind: 'player', team: 'def', label: d.label, x: dxs[i], y: 30 + (i % 2 ? 12 : 0) }));
    const axs = spread(atk.length, 16, 84);
    atk.forEach((a, i) => o.push({ id: a.id, kind: 'player', team: 'atk', label: a.label, x: axs[i], y: 60 + (i % 3) * 10 }));
    if (hasBall) o.push({ id: 'ball', kind: 'ball', x: (axs[0] != null ? axs[0] : 50), y: 82 });
    return o;
  }

  const icon = p => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

  const LIST = [
    { id: 'handball', name: { en: 'Handball', da: 'Håndbold' }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>') },
    { id: 'soccer', name: { en: 'Soccer', da: 'Fodbold' }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="m12 7 3 2-1 3.5h-4L9 9z"/>') },
    { id: 'basketball', name: { en: 'Basketball', da: 'Basketball' }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5 5c4 3 4 11 0 14M19 5c-4 3-4 11 0 14"/>') },
    { id: 'volleyball', name: { en: 'Volleyball', da: 'Volleyball' }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 3a15 15 0 0 0 0 18M3.5 8A15 15 0 0 0 20 15M20.5 8A15 15 0 0 1 4 15"/>') },
    { id: 'baseball', name: { en: 'Baseball', da: 'Baseball' }, icon: icon('<circle cx="12" cy="12" r="9"/><path d="M6 5c3 3 3 11 0 14M18 5c-3 3-3 11 0 14"/>') },
    { id: 'rugby', name: { en: 'Rugby', da: 'Rugby' }, icon: icon('<ellipse cx="12" cy="12" rx="9" ry="6"/><path d="M8 12h8M12 9v6"/>') },
    { id: 'football', name: { en: 'American Football', da: 'Amerikansk Fodbold' }, icon: icon('<ellipse cx="12" cy="12" rx="9" ry="6"/><path d="M7 12h10M10 10v4M14 10v4"/>') },
    { id: 'badminton', name: { en: 'Badminton', da: 'Badminton' }, icon: icon('<path d="M4 20l7-7"/><circle cx="15" cy="9" r="5"/><path d="M15 4v10M10 9h10"/>') },
    { id: 'tennis', name: { en: 'Tennis', da: 'Tennis' }, icon: icon('<ellipse cx="9" cy="8" rx="5" ry="6"/><path d="M6 8h6M9 3v10M9 13l-3 7"/><circle cx="18" cy="15" r="3"/>') },
    { id: 'snooker', name: { en: 'Snooker', da: 'Snooker' }, icon: icon('<circle cx="8" cy="16" r="4"/><path d="M11 13 21 3"/>') },
    { id: 'pool', name: { en: '8-Ball Pool', da: '8-ball Pool' }, icon: icon('<circle cx="9" cy="15" r="3"/><circle cx="15" cy="15" r="3"/><circle cx="12" cy="9.5" r="3"/>') },
    { id: 'darts', name: { en: 'Darts', da: 'Dart' }, icon: icon('<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="3"/><path d="m15 9 6-6M18 3h3v3"/>') },
    { id: 'icehockey', name: { en: 'Ice Hockey', da: 'Ishockey' }, icon: icon('<path d="M4 19 15 5"/><path d="M15 5l5 1-2 4"/><circle cx="6" cy="20" r="1.6" fill="currentColor" stroke="none"/>') },
    { id: 'floorball', name: { en: 'Floor Hockey', da: 'Floorball' }, icon: icon('<path d="M5 19 15 6"/><path d="M15 6l4 2-2 3"/><circle cx="7" cy="18" r="2.4"/>') },
    { id: 'chess', name: { en: 'Chess', da: 'Skak' }, icon: icon('<path d="M10.5 4a1.5 1.5 0 1 1 3 0c0 .8-.6 1.3-1 1.8.9.5 1.5 1.4 1.5 2.7 0 1.4-.7 2.3-1.4 3l.9 4.7H9.5l.9-4.7c-.7-.7-1.4-1.6-1.4-3 0-1.3.6-2.2 1.5-2.7-.4-.5-1-1-1-1.8Z"/><path d="M7 20h10"/>') },
    { id: 'bridge', name: { en: 'Bridge', da: 'Bridge' }, icon: icon('<rect x="3" y="7" width="10" height="13" rx="1.6"/><rect x="9" y="4" width="10" height="13" rx="1.6"/><path d="M14 8.6c.9 0 1.4 1 .7 1.8L14 11.4l-.7-1c-.7-.8-.2-1.8.7-1.8Z"/>') },
    { id: 'poker', name: { en: 'Poker', da: 'Poker' }, icon: icon('<rect x="3" y="5" width="11" height="15" rx="1.6"/><path d="M8.5 8.5c1.3 0 2 1.6 1 2.6L8.5 12.4 7 11.1c-1-1-.3-2.6 1-2.6Z"/><path d="M14 8l5 1.5a1.6 1.6 0 0 1 1.1 2l-2.6 8.4"/>') },
    { id: 'backgammon', name: { en: 'Backgammon', da: 'Backgammon' }, icon: icon('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M6 4l1.5 6L9 4M10 4l1.5 6L13 4M6 20l1.5-6L9 20M10 20l1.5-6L13 20M15 4v16"/>') }
  ];

  LIST.forEach(s => { s.court = courts[s.id]; s.formation = formations[s.id]; s.halfCourt = halfCourts[s.id]; });

  function get(id) { return LIST.find(s => s.id === id) || LIST[0]; }
  function halfCourt(id) { return halfCourts[id]; }
  function name(id, lang) { const s = get(id); return (s.name && s.name[lang]) || s.name.en; }

  // Playing positions per sport (English keys; translated via i18n 'pos.*').
  const POSITIONS = {
    handball: ['Goalkeeper', 'Left Wing', 'Left Back', 'Center Back', 'Right Back', 'Right Wing', 'Pivot'],
    soccer: ['Goalkeeper', 'Centre Back', 'Left Back', 'Right Back', 'Defensive Midfield', 'Central Midfield', 'Winger', 'Striker'],
    basketball: ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center'],
    volleyball: ['Setter', 'Outside Hitter', 'Opposite', 'Middle Blocker', 'Libero'],
    baseball: ['Pitcher', 'Catcher', 'First Base', 'Second Base', 'Third Base', 'Shortstop', 'Left Field', 'Center Field', 'Right Field'],
    rugby: ['Prop', 'Hooker', 'Lock', 'Flanker', 'Number 8', 'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback'],
    football: ['Quarterback', 'Running Back', 'Wide Receiver', 'Tight End', 'Offensive Line', 'Defensive Line', 'Linebacker', 'Cornerback', 'Safety'],
    badminton: ['Singles', 'Doubles', 'Mixed Doubles'],
    tennis: ['Singles', 'Doubles', 'Mixed Doubles'],
    snooker: ['Player'],
    pool: ['Player'],
    darts: ['Player'],
    icehockey: ['Goalkeeper', 'Left Defense', 'Right Defense', 'Left Wing', 'Center', 'Right Wing'],
    floorball: ['Goalkeeper', 'Defender', 'Left Wing', 'Center', 'Right Wing'],
    chess: ['Player'],
    bridge: ['North', 'East', 'South', 'West'],
    poker: ['Button', 'Small Blind', 'Big Blind', 'Under the Gun', 'Middle', 'Cutoff'],
    backgammon: ['Player']
  };
  function positions(id) { return POSITIONS[id] || POSITIONS.handball; }

  // Squad badge per playing position: the shirt abbreviation coaches actually
  // use, plus a role that decides the badge colour. Keyed per sport because the
  // same name means different things elsewhere (basketball "Center" vs
  // ice-hockey "Center").
  const ROLE_COLORS = { gk: '#f0a020', def: '#3b82f6', mid: '#10b981', att: '#ef4444', util: '#a855f7' };
  const POS_META = {
    handball: { 'Goalkeeper': ['GK', 'gk'], 'Left Wing': ['LW', 'att'], 'Left Back': ['LB', 'mid'], 'Center Back': ['CB', 'mid'], 'Right Back': ['RB', 'mid'], 'Right Wing': ['RW', 'att'], 'Pivot': ['PV', 'att'] },
    soccer: { 'Goalkeeper': ['GK', 'gk'], 'Centre Back': ['CB', 'def'], 'Left Back': ['LB', 'def'], 'Right Back': ['RB', 'def'], 'Defensive Midfield': ['DM', 'mid'], 'Central Midfield': ['CM', 'mid'], 'Winger': ['WG', 'att'], 'Striker': ['ST', 'att'] },
    basketball: { 'Point Guard': ['PG', 'mid'], 'Shooting Guard': ['SG', 'att'], 'Small Forward': ['SF', 'att'], 'Power Forward': ['PF', 'def'], 'Center': ['C', 'def'] },
    volleyball: { 'Setter': ['S', 'mid'], 'Outside Hitter': ['OH', 'att'], 'Opposite': ['OPP', 'att'], 'Middle Blocker': ['MB', 'def'], 'Libero': ['L', 'def'] },
    baseball: { 'Pitcher': ['P', 'util'], 'Catcher': ['C', 'gk'], 'First Base': ['1B', 'def'], 'Second Base': ['2B', 'def'], 'Third Base': ['3B', 'def'], 'Shortstop': ['SS', 'def'], 'Left Field': ['LF', 'att'], 'Center Field': ['CF', 'att'], 'Right Field': ['RF', 'att'] },
    rugby: { 'Prop': ['PR', 'def'], 'Hooker': ['HK', 'def'], 'Lock': ['LK', 'def'], 'Flanker': ['FL', 'mid'], 'Number 8': ['N8', 'mid'], 'Scrum-half': ['SH', 'mid'], 'Fly-half': ['FH', 'mid'], 'Centre': ['CE', 'att'], 'Wing': ['WG', 'att'], 'Fullback': ['FB', 'def'] },
    football: { 'Quarterback': ['QB', 'mid'], 'Running Back': ['RB', 'att'], 'Wide Receiver': ['WR', 'att'], 'Tight End': ['TE', 'att'], 'Offensive Line': ['OL', 'util'], 'Defensive Line': ['DL', 'def'], 'Linebacker': ['LB', 'def'], 'Cornerback': ['CB', 'def'], 'Safety': ['S', 'def'] },
    badminton: { 'Singles': ['S', 'att'], 'Doubles': ['D', 'mid'], 'Mixed Doubles': ['MD', 'util'] },
    tennis: { 'Singles': ['S', 'att'], 'Doubles': ['D', 'mid'], 'Mixed Doubles': ['MD', 'util'] },
    snooker: { 'Player': ['P', 'util'] },
    pool: { 'Player': ['P', 'util'] },
    darts: { 'Player': ['P', 'util'] },
    icehockey: { 'Goalkeeper': ['GK', 'gk'], 'Left Defense': ['LD', 'def'], 'Right Defense': ['RD', 'def'], 'Left Wing': ['LW', 'att'], 'Center': ['C', 'mid'], 'Right Wing': ['RW', 'att'] },
    floorball: { 'Goalkeeper': ['GK', 'gk'], 'Defender': ['D', 'def'], 'Left Wing': ['LW', 'att'], 'Center': ['C', 'mid'], 'Right Wing': ['RW', 'att'] },
    chess: { 'Player': ['P', 'util'] },
    bridge: { 'North': ['N', 'util'], 'East': ['E', 'mid'], 'South': ['S', 'att'], 'West': ['W', 'def'] },
    poker: { 'Button': ['BTN', 'att'], 'Small Blind': ['SB', 'mid'], 'Big Blind': ['BB', 'mid'], 'Under the Gun': ['UTG', 'def'], 'Middle': ['MP', 'util'], 'Cutoff': ['CO', 'att'] },
    backgammon: { 'Player': ['P', 'util'] }
  };
  // { ab, role, color } for a position; a neutral '?' badge when unset.
  function posBadge(id, pos) {
    const map = POS_META[id] || POS_META.handball;
    const hit = (pos && map[pos]) || ['?', 'util'];
    return { ab: hit[0], role: hit[1], color: ROLE_COLORS[hit[1]] };
  }

  // Exercise/training categories per sport (translated via i18n 'cat.*').
  const EXCATS = {
    handball: ['Attack', 'Defense', 'Goalkeeper', 'Passing', 'Shooting', 'Transition', 'Conditioning'],
    soccer: ['Attack', 'Defense', 'Goalkeeper', 'Passing', 'Finishing', 'Set Pieces', 'Fitness'],
    basketball: ['Offense', 'Defense', 'Shooting', 'Ball Handling', 'Rebounding', 'Conditioning'],
    volleyball: ['Serving', 'Passing', 'Setting', 'Attacking', 'Blocking', 'Defense'],
    baseball: ['Batting', 'Pitching', 'Fielding', 'Base Running', 'Conditioning'],
    rugby: ['Attack', 'Defense', 'Set Piece', 'Kicking', 'Fitness'],
    football: ['Offense', 'Defense', 'Special Teams', 'Conditioning'],
    badminton: ['Serving', 'Footwork', 'Smash', 'Net Play', 'Defense'],
    tennis: ['Serving', 'Forehand', 'Backhand', 'Volley', 'Footwork'],
    snooker: ['Potting', 'Positional', 'Safety', 'Break Building'],
    pool: ['Potting', 'Position', 'Break', 'Safety'],
    darts: ['Scoring', 'Doubles', 'Checkouts', 'Consistency'],
    icehockey: ['Skating', 'Passing', 'Shooting', 'Defense', 'Power Play', 'Conditioning'],
    floorball: ['Passing', 'Shooting', 'Defense', 'Power Play', 'Conditioning'],
    chess: ['Openings', 'Tactics', 'Endgames', 'Strategy', 'Calculation'],
    bridge: ['Bidding', 'Declarer Play', 'Defense', 'Conventions', 'Endplay'],
    poker: ['Preflop', 'Postflop', 'Pot Odds', 'Bluffing', 'Bankroll'],
    backgammon: ['Opening', 'Priming', 'Backgame', 'Bearing Off', 'Doubling']
  };
  function exerciseCategories(id) { return EXCATS[id] || EXCATS.handball; }

  // Typical opponent formations / playing styles per sport.
  const OPP_FORMATIONS = {
    handball: ['6-0', '5-1', '3-2-1', '4-2', 'Man-to-Man'],
    soccer: ['4-4-2', '4-3-3', '3-5-2', '5-3-2', '4-2-3-1'],
    basketball: ['Man-to-Man', '2-3 Zone', '3-2 Zone', '1-3-1 Zone', 'Full-Court Press'],
    volleyball: ['5-1', '6-2', '4-2'],
    baseball: ['Standard', 'Infield Shift', 'Infield In', 'No-Doubles'],
    rugby: ['Blitz Defense', 'Drift Defense', 'Rush Defense'],
    football: ['4-3', '3-4', 'Nickel', 'Cover 2', 'Cover 3'],
    badminton: ['Front-Back', 'Side-by-Side', 'Rotation'],
    tennis: ['Baseline', 'Serve & Volley', 'All-Court', 'Counter-puncher'],
    snooker: ['Attacking', 'Safety-first', 'Tactical'],
    pool: ['Aggressive', 'Safety-first', 'Position-based'],
    darts: ['Scoring', 'Steady', 'Aggressive'],
    icehockey: ['1-2-2 Trap', '2-1-2', 'Left-Wing Lock', 'Man-to-Man'],
    floorball: ['2-2-1', '3-1', 'Man-to-Man'],
    chess: ['Aggressive', 'Positional', 'Defensive', 'Gambit', 'Hypermodern'],
    bridge: ['Standard American', 'Acol', '2/1 Game Force', 'Precision', 'Weak NT'],
    poker: ['Tight-Aggressive', 'Loose-Aggressive', 'Tight-Passive', 'Loose-Passive', 'Maniac'],
    backgammon: ['Blitz', 'Priming Game', 'Backgame', 'Holding Game', 'Running Game']
  };
  function oppFormations(id) { return OPP_FORMATIONS[id] || OPP_FORMATIONS.handball; }

  // Team sports have a coach-managed squad (roster) — used to gate team sync features.
  const TEAM_SPORTS = ['handball', 'soccer', 'basketball', 'volleyball', 'baseball', 'rugby', 'football', 'icehockey', 'floorball'];
  function isTeam(id) { return TEAM_SPORTS.indexOf(id) >= 0; }

  // ---- Training props / equipment (sport-category based) ----
  // Reusable coaching equipment that can be dropped on the tactical board.
  const PROP_TYPES = {
    cone: { en: 'Cone', da: 'Kegle' },
    disc: { en: 'Marker disc', da: 'Markeringsskive' },
    pole: { en: 'Slalom pole', da: 'Slalomstang' },
    hurdle: { en: 'Hurdle', da: 'Hæk' },
    ladder: { en: 'Agility ladder', da: 'Koordinationsstige' },
    ring: { en: 'Ring', da: 'Ring' },
    minigoal: { en: 'Mini goal', da: 'Minimål' },
    dummy: { en: 'Dummy / mannequin', da: 'Markeringsdukke' },
    medicineball: { en: 'Medicine ball', da: 'Medicinbold' },
    target: { en: 'Target', da: 'Målskive' }
  };
  // Which props make sense per sport category (court, field, racket).
  const PROPS = {
    handball: ['cone', 'disc', 'hurdle', 'ladder', 'ring', 'dummy', 'minigoal', 'medicineball'],
    soccer: ['cone', 'disc', 'pole', 'hurdle', 'ladder', 'minigoal', 'dummy', 'medicineball'],
    futsal: ['cone', 'disc', 'pole', 'hurdle', 'ladder', 'minigoal', 'medicineball'],
    basketball: ['cone', 'disc', 'pole', 'hurdle', 'ladder', 'ring', 'medicineball'],
    volleyball: ['cone', 'disc', 'ring', 'target', 'medicineball'],
    baseball: ['cone', 'disc', 'pole', 'ladder', 'target', 'medicineball'],
    rugby: ['cone', 'disc', 'pole', 'hurdle', 'ladder', 'dummy', 'medicineball'],
    football: ['cone', 'disc', 'pole', 'hurdle', 'ladder', 'dummy', 'medicineball'],
    icehockey: ['cone', 'disc', 'pole', 'ring', 'minigoal', 'target'],
    floorball: ['cone', 'disc', 'pole', 'ring', 'minigoal', 'target'],
    tennis: ['cone', 'disc', 'target', 'ladder', 'ring'],
    badminton: ['cone', 'disc', 'target', 'ladder', 'ring']
  };
  // Returns a list of {type, name} props for the sport (empty for board/cue games).
  function props(id) {
    const list = PROPS[id];
    if (!list) return [];
    return list.map(t => ({ type: t, name: PROP_TYPES[t] || { en: t, da: t } }));
  }

  return { LIST, get, name, positions, posBadge, exerciseCategories, oppFormations, isTeam, halfFormation, halfCourt, props };
})();
if (typeof window !== 'undefined') window.SPORTS = SPORTS;
