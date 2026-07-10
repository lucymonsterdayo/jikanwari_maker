'use strict';

/* ---------- Constants ---------- */

var LS_KEY = 'jikanwari_maker_draft_v1';

var GRADE_OPTIONS = [
  { group: '小学生', category: 'elementary', items: ['小1', '小2', '小3', '小4', '小5', '小6'] },
  { group: '中学生', category: 'middle', items: ['中1', '中2', '中3'] },
  { group: '高校生', category: 'high', items: ['高1', '高2', '高3'] },
  { group: 'その他', category: 'other', items: ['既卒', '幼児', '一般', 'その他'] }
];

var GRADE_TO_CATEGORY = {};
GRADE_OPTIONS.forEach(function (g) {
  g.items.forEach(function (i) { GRADE_TO_CATEGORY[i] = g.category; });
});

var CATEGORY_LABEL = { elementary: '小学生', middle: '中学生', high: '高校生', other: 'その他' };
var CATEGORY_ORDER = ['elementary', 'middle', 'high', 'other'];
var DEFAULT_DURATION = 60;

var SUBJECT_COLORS = [
  { id: 'red', label: '赤', bg: '#ffe3e8', border: '#ff8fa8', text: '#b3264d' },
  { id: 'orange', label: 'オレンジ', bg: '#ffe9d9', border: '#ffab77', text: '#c1621f' },
  { id: 'yellow', label: '黄', bg: '#fff6d9', border: '#ffd966', text: '#8a6d00' },
  { id: 'green', label: '緑', bg: '#e2f8ea', border: '#6fd39a', text: '#1f8a56' },
  { id: 'teal', label: '青緑', bg: '#d9f7f3', border: '#5cc9bd', text: '#10746a' },
  { id: 'blue', label: '青', bg: '#e3eeff', border: '#7fb0f5', text: '#2762b8' },
  { id: 'indigo', label: '藍', bg: '#e8e6ff', border: '#9089f0', text: '#4a3fb0' },
  { id: 'purple', label: '紫', bg: '#f3e3ff', border: '#c68cf5', text: '#7a2fb0' },
  { id: 'pink', label: 'ピンク', bg: '#ffe3f4', border: '#ff8fcb', text: '#b3266f' },
  { id: 'gray', label: 'グレー', bg: '#eef0f2', border: '#a9b0b8', text: '#51565c' }
];
var SUBJECT_COLOR_MAP = {};
SUBJECT_COLORS.forEach(function (c) { SUBJECT_COLOR_MAP[c.id] = c; });

/* ---------- State ---------- */

var state = null;
var filter = { elementary: true, middle: true, high: true, other: true };
var fileHandle = null;
var pendingCell = null;       // {dayId, roomId, startMinutes} awaiting a template pick
var currentCellClassId = null; // classes entry currently shown in cellModal
var newSubjectColor = SUBJECT_COLORS[0].id;
var newCatGrades = [];        // grades chosen for the catalog "add new" row
var gradePickerSelection = []; // working selection while the grade picker modal is open
var gradePickerOnApply = null; // callback(selectedGrades) invoked when the grade picker is confirmed
var gradePickerReturnModalId = null; // modal to reopen after the grade picker closes

/* ---------- Utils ---------- */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function sanitizeFileName(name) {
  var cleaned = (name || '時間割').replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || '時間割';
}

function mkBtn(text, onClick, cls) {
  var b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.classList.add(cls);
  b.addEventListener('click', onClick);
  return b;
}

function getTemplateGrades(tmpl) {
  if (Array.isArray(tmpl.grades)) return tmpl.grades;
  if (tmpl.grade) return [tmpl.grade];
  return [];
}

function categoriesForGrades(grades) {
  var set = {};
  (grades || []).forEach(function (g) { var c = GRADE_TO_CATEGORY[g]; if (c) set[c] = true; });
  return CATEGORY_ORDER.filter(function (c) { return set[c]; });
}

function templateCategories(tmpl) {
  return categoriesForGrades(getTemplateGrades(tmpl));
}

function gradesLabel(grades) {
  if (!grades || !grades.length) return '学年未設定';
  return grades.join('・');
}

function chipInnerHtml(tmpl, timeRangeLabel) {
  var duration = tmpl.duration || DEFAULT_DURATION;
  var subject = state.subjects.find(function (s) { return s.id === tmpl.subjectId; });
  var subjectName = subject ? subject.name : '(科目未設定)';
  var grades = getTemplateGrades(tmpl);
  var dotsHtml = templateCategories(tmpl).map(function (c) {
    return '<span class="dot cat-' + c + '"></span>';
  }).join('');

  var html = '<span class="chip-grade">' + dotsHtml +
    '<span class="chip-grade-text">' + escapeHtml(gradesLabel(grades)) + ' ・ ' + duration + '分</span></span>' +
    '<span class="chip-subject">' + escapeHtml(subjectName) + '</span>';

  var metaParts = [];
  if (tmpl.teacher) metaParts.push('👤 ' + escapeHtml(tmpl.teacher));
  if (tmpl.note) metaParts.push(escapeHtml(tmpl.note));
  if (metaParts.length) html += '<span class="chip-meta">' + metaParts.join(' ・ ') + '</span>';

  if (timeRangeLabel) html += '<span class="chip-time">' + escapeHtml(timeRangeLabel) + '</span>';
  return html;
}

function classTimeRangeLabel(cls, tmpl) {
  var duration = (tmpl && tmpl.duration) || DEFAULT_DURATION;
  return minutesToTime(cls.startMinutes) + '〜' + minutesToTime(cls.startMinutes + duration);
}

function applyChipColor(el, tmpl) {
  var subject = state.subjects.find(function (s) { return s.id === tmpl.subjectId; });
  var c = subject ? SUBJECT_COLOR_MAP[subject.color] : null;
  if (c) {
    el.style.background = c.bg;
    el.style.borderColor = c.border;
    el.style.color = c.text;
  } else {
    el.classList.add('subj-none');
  }
}

function renderColorPicker(container, selectedId, onSelect) {
  container.innerHTML = '';
  SUBJECT_COLORS.forEach(function (c) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (c.id === selectedId ? ' selected' : '');
    btn.style.background = c.border;
    btn.title = c.label;
    btn.addEventListener('click', function () { onSelect(c.id); });
    container.appendChild(btn);
  });
}

var toastTimer = null;
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}

/* ---------- Time axis helpers ---------- */

function timeToMinutes(t) {
  var parts = String(t).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function minutesToTime(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}

function scheduleRows() {
  var s = state.schedule;
  var startMin = timeToMinutes(s.start);
  var endMin = timeToMinutes(s.end);
  var unit = s.unit;
  var rows = [];
  for (var m = startMin; m < endMin; m += unit) rows.push(m);
  return rows;
}

function templateSpan(tmpl) {
  if (!tmpl) return 1;
  var unit = state.schedule.unit;
  return Math.max(1, Math.ceil((tmpl.duration || DEFAULT_DURATION) / unit));
}

function canPlace(dayId, roomId, startMinutes, span, excludeClassId) {
  var rows = scheduleRows();
  var startIdx = rows.indexOf(startMinutes);
  if (startIdx === -1) return false;
  if (startIdx + span > rows.length) return false;
  var newEndIdx = startIdx + span;
  return !state.classes.some(function (c) {
    if (c.dayId !== dayId || c.roomId !== roomId) return false;
    if (excludeClassId && c.id === excludeClassId) return false;
    var tmpl = state.catalog.find(function (t) { return t.id === c.templateId; });
    var cSpan = templateSpan(tmpl);
    var cStartIdx = rows.indexOf(c.startMinutes);
    if (cStartIdx === -1) return false;
    var cEndIdx = cStartIdx + cSpan;
    return startIdx < cEndIdx && cStartIdx < newEndIdx;
  });
}

/* ---------- Default / normalize state ---------- */

function defaultState() {
  var dayDefs = [
    ['mon', '月', true], ['tue', '火', true], ['wed', '水', true],
    ['thu', '木', true], ['fri', '金', true], ['sat', '土', true], ['sun', '日', false]
  ];
  var rooms = [{ id: uid(), name: '教室A' }, { id: uid(), name: '教室B' }];
  var subjects = [
    { id: uid(), name: '算数', color: 'green' },
    { id: uid(), name: '数学', color: 'blue' },
    { id: uid(), name: '英語', color: 'purple' },
    { id: uid(), name: '英検対策', color: 'yellow' }
  ];
  var catalog = [
    { id: uid(), grades: ['小5'], subjectId: subjects[0].id, teacher: '田中', note: '', duration: 60 },
    { id: uid(), grades: ['中2'], subjectId: subjects[1].id, teacher: '鈴木', note: '', duration: 60 },
    { id: uid(), grades: ['高3'], subjectId: subjects[2].id, teacher: '山田', note: '受験クラス', duration: 90 },
    { id: uid(), grades: ['小6', '中1', '中2'], subjectId: subjects[3].id, teacher: '', note: '準2級対策', duration: 60 }
  ];
  return {
    title: '○○塾 時間割',
    days: dayDefs.map(function (d) { return { id: d[0], label: d[1], active: d[2] }; }),
    rooms: rooms,
    schedule: { start: '16:00', end: '21:30', unit: 30 },
    subjects: subjects,
    catalog: catalog,
    classes: []
  };
}

function normalizeState(parsed) {
  var d = defaultState();
  if (!parsed || typeof parsed !== 'object') return d;
  var schedule = d.schedule;
  if (parsed.schedule && typeof parsed.schedule.start === 'string' && typeof parsed.schedule.end === 'string' && parsed.schedule.unit) {
    schedule = { start: parsed.schedule.start, end: parsed.schedule.end, unit: parseInt(parsed.schedule.unit, 10) || 30 };
  }
  return {
    title: typeof parsed.title === 'string' ? parsed.title : d.title,
    days: Array.isArray(parsed.days) && parsed.days.length ? parsed.days : d.days,
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms : d.rooms,
    schedule: schedule,
    subjects: Array.isArray(parsed.subjects) ? parsed.subjects : d.subjects,
    catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
    classes: Array.isArray(parsed.classes) ? parsed.classes : []
  };
}

function persistLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore quota / privacy errors */ }
}

/* ---------- Rendering: top-level ---------- */

function render() {
  document.getElementById('titleInput').value = state.title;
  document.getElementById('printTitle').textContent = state.title;
  renderGrid();
}

var TOP_ROW_MAX_DAYS = 3;

function renderGrid() {
  var activeDays = state.days.filter(function (d) { return d.active; });
  var topDays = activeDays.slice(0, TOP_ROW_MAX_DAYS);
  var bottomDays = activeDays.slice(TOP_ROW_MAX_DAYS);

  renderGridTable(document.getElementById('gridTop'), topDays);

  var bottomWrap = document.getElementById('gridBottomWrap');
  if (bottomDays.length) {
    bottomWrap.classList.remove('hidden');
    renderGridTable(document.getElementById('gridBottom'), bottomDays);
  } else {
    bottomWrap.classList.add('hidden');
    document.getElementById('gridBottom').innerHTML = '';
  }
}

function renderGridTable(table, activeDays) {
  table.innerHTML = '';
  var roomsToRender = state.rooms.length ? state.rooms : [{ id: '__none__', name: '(教室未設定)' }];
  var rows = scheduleRows();

  var thead = document.createElement('thead');

  var rowDay = document.createElement('tr');
  var cornerTh = document.createElement('th');
  cornerTh.className = 'corner';
  cornerTh.rowSpan = 2;
  cornerTh.textContent = '時間';
  rowDay.appendChild(cornerTh);
  activeDays.forEach(function (day) {
    var th = document.createElement('th');
    th.colSpan = roomsToRender.length;
    th.textContent = day.label;
    th.className = 'day-head';
    rowDay.appendChild(th);
  });
  thead.appendChild(rowDay);

  var rowRoom = document.createElement('tr');
  activeDays.forEach(function () {
    roomsToRender.forEach(function (room) {
      var th = document.createElement('th');
      th.textContent = room.name;
      th.className = 'room-head';
      rowRoom.appendChild(th);
    });
  });
  thead.appendChild(rowRoom);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var consumedUntil = {};
  activeDays.forEach(function (day) {
    consumedUntil[day.id] = {};
    roomsToRender.forEach(function (room) { consumedUntil[day.id][room.id] = 0; });
  });

  rows.forEach(function (rowStartMin, rowIdx) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.className = 'slot-head' + (rowStartMin % 60 === 0 ? ' hour-mark' : '');
    th.textContent = minutesToTime(rowStartMin);
    tr.appendChild(th);

    activeDays.forEach(function (day) {
      roomsToRender.forEach(function (room) {
        if (room.id === '__none__') {
          var placeholderTd = document.createElement('td');
          placeholderTd.className = 'cell';
          tr.appendChild(placeholderTd);
          return;
        }
        if (consumedUntil[day.id][room.id] > rowIdx) return; // covered by a rowspan from above

        var td = document.createElement('td');
        td.className = 'cell';
        td.dataset.day = day.id;
        td.dataset.room = room.id;
        td.dataset.start = rowStartMin;

        var cls = state.classes.find(function (c) {
          return c.dayId === day.id && c.roomId === room.id && c.startMinutes === rowStartMin;
        });

        if (cls) {
          var tmpl = state.catalog.find(function (t) { return t.id === cls.templateId; });
          var span = Math.min(templateSpan(tmpl), rows.length - rowIdx);
          td.rowSpan = span;
          consumedUntil[day.id][room.id] = rowIdx + span;
          var block = buildClassBlock(cls, tmpl);
          if (block) td.appendChild(block);
        } else {
          td.rowSpan = 1;
          consumedUntil[day.id][room.id] = rowIdx + 1;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'add-btn';
          btn.textContent = '＋';
          btn.title = '授業を選ぶ';
          btn.addEventListener('click', function () {
            openPicker({ dayId: day.id, roomId: room.id, startMinutes: rowStartMin });
          });
          td.appendChild(btn);
        }
        td.addEventListener('dragover', function (e) { e.preventDefault(); });
        td.addEventListener('drop', function (e) { handleDrop(e, day.id, room.id, rowStartMin); });
        tr.appendChild(td);
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function buildClassBlock(cls, tmpl) {
  if (!tmpl) return null;
  var div = document.createElement('div');
  div.className = 'class-block chip';
  div.draggable = true;
  div.dataset.id = cls.id;
  var cats = templateCategories(tmpl);
  var anyVisible = cats.length === 0 || cats.some(function (c) { return filter[c]; });
  if (!anyVisible) div.classList.add('filtered-out');
  div.innerHTML = chipInnerHtml(tmpl, classTimeRangeLabel(cls, tmpl));
  applyChipColor(div, tmpl);

  div.addEventListener('click', function () { openCellModal(cls.id); });
  div.addEventListener('dragstart', function (e) {
    e.dataTransfer.setData('text/plain', cls.id);
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', function () { div.classList.remove('dragging'); });
  return div;
}

function handleDrop(e, dayId, roomId, startMinutes) {
  e.preventDefault();
  var id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  var cls = state.classes.find(function (c) { return c.id === id; });
  if (!cls) return;
  var tmpl = state.catalog.find(function (t) { return t.id === cls.templateId; });
  var span = templateSpan(tmpl);
  if (!canPlace(dayId, roomId, startMinutes, span, cls.id)) {
    toast('このコマには移動できません(時間が重なるか、範囲外です)');
    return;
  }
  cls.dayId = dayId; cls.roomId = roomId; cls.startMinutes = startMinutes;
  persistLocal();
  renderGrid();
}

function assignTemplateToCell(dayId, roomId, startMinutes, templateId) {
  var tmpl = state.catalog.find(function (t) { return t.id === templateId; });
  var span = templateSpan(tmpl);
  var existing = state.classes.find(function (c) {
    return c.dayId === dayId && c.roomId === roomId && c.startMinutes === startMinutes;
  });
  var excludeId = existing ? existing.id : null;
  if (!canPlace(dayId, roomId, startMinutes, span, excludeId)) {
    toast('この時間には配置できません(他の授業と重なるか、表示時間の範囲外です)');
    return false;
  }
  if (existing) {
    existing.templateId = templateId;
  } else {
    state.classes.push({ id: uid(), dayId: dayId, roomId: roomId, startMinutes: startMinutes, templateId: templateId });
  }
  persistLocal();
  renderGrid();
  return true;
}

/* ---------- Modal generic ---------- */

function showModal(id) {
  document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModals() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

/* ---------- Picker modal (choose a registered class for a cell) ---------- */

function openPicker(cell) {
  pendingCell = cell;
  renderPicker();
  showModal('pickerModal');
}

function renderPicker() {
  var body = document.getElementById('pickerList');
  body.innerHTML = '';
  if (state.catalog.length === 0) {
    var p = document.createElement('p');
    p.className = 'picker-empty-text';
    p.textContent = 'まだ授業が登録されていません。「＋ 新しい授業を登録」から登録してみましょう。';
    body.appendChild(p);
    return;
  }

  var singleGroups = {};
  CATEGORY_ORDER.forEach(function (cat) { singleGroups[cat] = []; });
  var mixedGroup = [];
  state.catalog.forEach(function (t) {
    var cats = templateCategories(t);
    if (cats.length === 1) singleGroups[cats[0]].push(t);
    else mixedGroup.push(t);
  });

  function renderGroup(label, items) {
    if (!items.length) return;
    var h = document.createElement('div');
    h.className = 'picker-group-label';
    h.textContent = label;
    body.appendChild(h);
    var wrap = document.createElement('div');
    wrap.className = 'picker-chips';
    items.forEach(function (tmpl) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = chipInnerHtml(tmpl);
      applyChipColor(chip, tmpl);
      chip.addEventListener('click', function () {
        if (!pendingCell) return;
        var ok = assignTemplateToCell(pendingCell.dayId, pendingCell.roomId, pendingCell.startMinutes, tmpl.id);
        if (ok) {
          pendingCell = null;
          closeModals();
          toast('配置しました');
        }
      });
      wrap.appendChild(chip);
    });
    body.appendChild(wrap);
  }

  CATEGORY_ORDER.forEach(function (cat) { renderGroup(CATEGORY_LABEL[cat], singleGroups[cat]); });
  renderGroup('複数学年(英検対策など)', mixedGroup);
}

/* ---------- Cell modal (view / change / clear a placed class) ---------- */

function openCellModal(classId) {
  var cls = state.classes.find(function (c) { return c.id === classId; });
  if (!cls) return;
  currentCellClassId = classId;
  var tmpl = state.catalog.find(function (t) { return t.id === cls.templateId; });
  var body = document.getElementById('cellModalBody');
  body.innerHTML = '';
  if (tmpl) {
    var preview = document.createElement('div');
    preview.className = 'chip chip-preview';
    preview.innerHTML = chipInnerHtml(tmpl, classTimeRangeLabel(cls, tmpl));
    applyChipColor(preview, tmpl);
    body.appendChild(preview);
  } else {
    body.innerHTML = '<p>登録内容が見つかりません</p>';
  }
  showModal('cellModal');
}

document.getElementById('btnClearCell').addEventListener('click', function () {
  if (!currentCellClassId) return;
  if (confirm('このコマを空にしますか？')) {
    state.classes = state.classes.filter(function (c) { return c.id !== currentCellClassId; });
    persistLocal();
    renderGrid();
    closeModals();
  }
});

document.getElementById('btnChangeCell').addEventListener('click', function () {
  var cls = state.classes.find(function (c) { return c.id === currentCellClassId; });
  if (!cls) return;
  openPicker({ dayId: cls.dayId, roomId: cls.roomId, startMinutes: cls.startMinutes });
});

/* ---------- Grade picker (multi-select, e.g. 英検 spanning several grades) ---------- */

function openGradePicker(currentGrades, onApply) {
  var visible = document.querySelector('.modal:not(.hidden)');
  gradePickerReturnModalId = visible ? visible.id : null;
  gradePickerSelection = (currentGrades || []).slice();
  gradePickerOnApply = onApply;
  renderGradePickerGroups();
  showModal('gradePickerModal');
}

function returnFromGradePicker() {
  var returnTo = gradePickerReturnModalId;
  gradePickerReturnModalId = null;
  gradePickerOnApply = null;
  if (returnTo) { showModal(returnTo); } else { closeModals(); }
}

function renderGradePickerGroups() {
  var container = document.getElementById('gradePickerGroups');
  container.innerHTML = '';
  GRADE_OPTIONS.forEach(function (g) {
    var groupDiv = document.createElement('div');
    groupDiv.className = 'grade-picker-group';

    var label = document.createElement('div');
    label.className = 'grade-picker-group-label';
    label.textContent = g.group;
    groupDiv.appendChild(label);

    var itemsWrap = document.createElement('div');
    itemsWrap.className = 'grade-picker-items';
    g.items.forEach(function (grade) {
      var item = document.createElement('label');
      item.className = 'grade-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = gradePickerSelection.indexOf(grade) !== -1;
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (gradePickerSelection.indexOf(grade) === -1) gradePickerSelection.push(grade);
        } else {
          gradePickerSelection = gradePickerSelection.filter(function (x) { return x !== grade; });
        }
      });
      item.appendChild(cb);
      item.appendChild(document.createTextNode(grade));
      itemsWrap.appendChild(item);
    });
    groupDiv.appendChild(itemsWrap);
    container.appendChild(groupDiv);
  });
}

document.getElementById('btnGradePickerCancel').addEventListener('click', returnFromGradePicker);

document.getElementById('btnGradePickerOk').addEventListener('click', function () {
  if (gradePickerSelection.length === 0) { toast('学年を1つ以上選択してください'); return; }
  var selected = gradePickerSelection.slice();
  var cb = gradePickerOnApply;
  returnFromGradePicker();
  if (cb) cb(selected);
});

/* ---------- Catalog management (授業マスタ) ---------- */

function refreshNewCatGradeButton() {
  var btn = document.getElementById('newCatGradeBtn');
  btn.textContent = newCatGrades.length ? gradesLabel(newCatGrades) : '学年を選択';
  btn.title = btn.textContent;
}

document.getElementById('newCatGradeBtn').addEventListener('click', function () {
  openGradePicker(newCatGrades, function (selected) {
    newCatGrades = selected;
    refreshNewCatGradeButton();
  });
});

function openCatalogModal() {
  renderCatalogList();
  refreshNewCatSubjectOptions();
  refreshNewCatGradeButton();
  showModal('catalogModal');
}

function refreshNewCatSubjectOptions() {
  var sel = document.getElementById('newCatSubject');
  sel.innerHTML = state.subjects.map(function (s) {
    return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
  }).join('');
}

function buildSubjectSelectHtml(selectedId) {
  return state.subjects.map(function (s) {
    return '<option value="' + s.id + '"' + (s.id === selectedId ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>';
  }).join('');
}

function renderCatalogList() {
  var ul = document.getElementById('catalogList');
  ul.innerHTML = '';
  if (state.subjects.length === 0) {
    var p = document.createElement('p');
    p.className = 'picker-empty-text';
    p.textContent = 'まだ科目が登録されていません。先に「🎨 科目設定」から科目を登録してください。';
    ul.appendChild(p);
  }
  state.catalog.forEach(function (tmpl) {
    var li = document.createElement('li');
    li.className = 'catalog-row';

    var dotsWrap = document.createElement('span');
    dotsWrap.className = 'dots-wrap';
    function refreshDots() {
      dotsWrap.innerHTML = templateCategories(tmpl).map(function (c) {
        return '<span class="dot cat-' + c + '"></span>';
      }).join('');
    }
    refreshDots();
    li.appendChild(dotsWrap);

    var gradeBtn = document.createElement('button');
    gradeBtn.type = 'button';
    gradeBtn.className = 'grade-btn';
    function refreshGradeBtn() {
      var grades = getTemplateGrades(tmpl);
      gradeBtn.textContent = gradesLabel(grades);
      gradeBtn.title = gradesLabel(grades);
    }
    refreshGradeBtn();
    gradeBtn.addEventListener('click', function () {
      openGradePicker(getTemplateGrades(tmpl), function (selected) {
        tmpl.grades = selected;
        if (tmpl.grade) delete tmpl.grade;
        persistLocal(); renderGrid();
        refreshDots();
        refreshGradeBtn();
      });
    });
    li.appendChild(gradeBtn);

    var subjectSel = document.createElement('select');
    subjectSel.innerHTML = buildSubjectSelectHtml(tmpl.subjectId);
    subjectSel.addEventListener('change', function () {
      tmpl.subjectId = subjectSel.value;
      persistLocal(); renderGrid();
    });
    li.appendChild(subjectSel);

    var durationWrap = document.createElement('span');
    durationWrap.className = 'duration-wrap';
    var durationInput = document.createElement('input');
    durationInput.type = 'number';
    durationInput.min = '10';
    durationInput.step = '5';
    durationInput.value = tmpl.duration || DEFAULT_DURATION;
    durationInput.addEventListener('change', function () {
      var v = parseInt(durationInput.value, 10);
      tmpl.duration = (isFinite(v) && v > 0) ? v : DEFAULT_DURATION;
      durationInput.value = tmpl.duration;
      persistLocal(); renderGrid();
    });
    durationWrap.appendChild(durationInput);
    durationWrap.appendChild(document.createTextNode('分'));
    li.appendChild(durationWrap);

    var teacherInput = document.createElement('input');
    teacherInput.type = 'text';
    teacherInput.placeholder = '講師';
    teacherInput.value = tmpl.teacher || '';
    teacherInput.addEventListener('change', function () {
      tmpl.teacher = teacherInput.value.trim();
      persistLocal(); renderGrid();
    });
    li.appendChild(teacherInput);

    var noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'クラス名・生徒名';
    noteInput.value = tmpl.note || '';
    noteInput.addEventListener('change', function () {
      tmpl.note = noteInput.value.trim();
      persistLocal(); renderGrid();
    });
    li.appendChild(noteInput);

    li.appendChild(mkBtn('削除', function () {
      var usedCount = state.classes.filter(function (c) { return c.templateId === tmpl.id; }).length;
      var msg = usedCount > 0
        ? 'この授業を削除すると、時間割に配置されている' + usedCount + '件も削除されます。よろしいですか？'
        : 'この授業を削除しますか？';
      if (confirm(msg)) {
        state.classes = state.classes.filter(function (c) { return c.templateId !== tmpl.id; });
        state.catalog = state.catalog.filter(function (t) { return t.id !== tmpl.id; });
        persistLocal(); renderGrid(); renderCatalogList();
      }
    }, 'danger'));

    ul.appendChild(li);
  });
}

document.getElementById('btnAddCatalog').addEventListener('click', function () {
  var subjectId = document.getElementById('newCatSubject').value;
  var teacher = document.getElementById('newCatTeacher').value.trim();
  var note = document.getElementById('newCatNote').value.trim();
  var durationRaw = parseInt(document.getElementById('newCatDuration').value, 10);
  var duration = (isFinite(durationRaw) && durationRaw > 0) ? durationRaw : DEFAULT_DURATION;
  if (newCatGrades.length === 0) { toast('学年を1つ以上選択してください'); return; }
  if (!subjectId) { toast('先に「🎨 科目設定」で科目を登録してください'); return; }
  var tmpl = { id: uid(), grades: newCatGrades.slice(), subjectId: subjectId, teacher: teacher, note: note, duration: duration };
  state.catalog.push(tmpl);
  persistLocal();

  newCatGrades = [];
  refreshNewCatGradeButton();
  document.getElementById('newCatTeacher').value = '';
  document.getElementById('newCatNote').value = '';
  document.getElementById('newCatDuration').value = '60';

  if (pendingCell) {
    var ok = assignTemplateToCell(pendingCell.dayId, pendingCell.roomId, pendingCell.startMinutes, tmpl.id);
    pendingCell = null;
    closeModals();
    toast(ok ? '登録してこのコマに配置しました' : '登録しました(このコマには配置できませんでした)');
  } else {
    renderCatalogList();
    toast('登録しました');
  }
});

/* ---------- Rooms management ---------- */

function renderRoomsList() {
  var ul = document.getElementById('roomsList');
  ul.innerHTML = '';
  state.rooms.forEach(function (room, idx) {
    var li = document.createElement('li');
    var input = document.createElement('input');
    input.type = 'text';
    input.value = room.name;
    input.addEventListener('change', function () {
      room.name = input.value.trim() || room.name;
      persistLocal(); renderGrid(); renderRoomsList();
    });
    li.appendChild(input);
    li.appendChild(mkBtn('↑', function () {
      if (idx > 0) {
        var tmp = state.rooms[idx - 1]; state.rooms[idx - 1] = state.rooms[idx]; state.rooms[idx] = tmp;
        persistLocal(); renderGrid(); renderRoomsList();
      }
    }));
    li.appendChild(mkBtn('↓', function () {
      if (idx < state.rooms.length - 1) {
        var tmp = state.rooms[idx + 1]; state.rooms[idx + 1] = state.rooms[idx]; state.rooms[idx] = tmp;
        persistLocal(); renderGrid(); renderRoomsList();
      }
    }));
    li.appendChild(mkBtn('削除', function () {
      var usedCount = state.classes.filter(function (c) { return c.roomId === room.id; }).length;
      var msg = usedCount > 0
        ? 'この教室を削除すると、登録済みの授業' + usedCount + '件も削除されます。よろしいですか？'
        : 'この教室を削除しますか？';
      if (confirm(msg)) {
        state.classes = state.classes.filter(function (c) { return c.roomId !== room.id; });
        state.rooms = state.rooms.filter(function (r) { return r.id !== room.id; });
        persistLocal(); renderGrid(); renderRoomsList();
      }
    }, 'danger'));
    ul.appendChild(li);
  });
}

document.getElementById('btnAddRoom').addEventListener('click', function () {
  var input = document.getElementById('newRoomName');
  var name = input.value.trim();
  if (!name) return;
  state.rooms.push({ id: uid(), name: name });
  input.value = '';
  persistLocal(); renderGrid(); renderRoomsList();
});

/* ---------- Subjects management (科目設定) ---------- */

function openSubjectsModal() {
  renderSubjectsList();
  initNewSubjectPicker();
  showModal('subjectsModal');
}

function renderSubjectsList() {
  var ul = document.getElementById('subjectsList');
  ul.innerHTML = '';
  state.subjects.forEach(function (subj) {
    var li = document.createElement('li');
    li.className = 'subject-row';

    var topRow = document.createElement('div');
    topRow.className = 'subject-row-top';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = subj.name;
    nameInput.addEventListener('change', function () {
      subj.name = nameInput.value.trim() || subj.name;
      persistLocal(); renderGrid(); renderSubjectsList();
    });
    topRow.appendChild(nameInput);

    topRow.appendChild(mkBtn('削除', function () {
      var affected = state.catalog.filter(function (t) { return t.subjectId === subj.id; });
      var usedCount = affected.length;
      var msg = usedCount > 0
        ? 'この科目を削除すると、登録されている授業' + usedCount + '件(時間割上の配置も含む)が削除されます。よろしいですか？'
        : 'この科目を削除しますか？';
      if (confirm(msg)) {
        var affectedIds = affected.map(function (t) { return t.id; });
        state.classes = state.classes.filter(function (c) { return affectedIds.indexOf(c.templateId) === -1; });
        state.catalog = state.catalog.filter(function (t) { return t.subjectId !== subj.id; });
        state.subjects = state.subjects.filter(function (s) { return s.id !== subj.id; });
        persistLocal(); renderGrid(); renderSubjectsList();
      }
    }, 'danger'));
    li.appendChild(topRow);

    var colorRow = document.createElement('div');
    colorRow.className = 'subject-row-colors';
    renderColorPicker(colorRow, subj.color, function (colorId) {
      subj.color = colorId;
      persistLocal(); renderGrid(); renderSubjectsList();
    });
    li.appendChild(colorRow);

    ul.appendChild(li);
  });
}

function initNewSubjectPicker() {
  var container = document.getElementById('newSubjectColorPicker');
  renderColorPicker(container, newSubjectColor, function (colorId) {
    newSubjectColor = colorId;
    initNewSubjectPicker();
  });
}

document.getElementById('btnAddSubject').addEventListener('click', function () {
  var input = document.getElementById('newSubjectName');
  var name = input.value.trim();
  if (!name) { toast('科目名を入力してください'); return; }
  state.subjects.push({ id: uid(), name: name, color: newSubjectColor });
  input.value = '';
  newSubjectColor = SUBJECT_COLORS[0].id;
  persistLocal();
  renderSubjectsList();
  initNewSubjectPicker();
  toast('科目を登録しました');
});

/* ---------- Schedule range management (表示時間設定) ---------- */

function openScheduleModal() {
  document.getElementById('schedStart').value = state.schedule.start;
  document.getElementById('schedEnd').value = state.schedule.end;
  document.getElementById('schedUnit').value = String(state.schedule.unit);
  showModal('scheduleModal');
}

function applyScheduleChange() {
  var start = document.getElementById('schedStart').value;
  var end = document.getElementById('schedEnd').value;
  var unit = parseInt(document.getElementById('schedUnit').value, 10);

  if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) {
    toast('終了時刻は開始時刻より後にしてください');
    document.getElementById('schedStart').value = state.schedule.start;
    document.getElementById('schedEnd').value = state.schedule.end;
    document.getElementById('schedUnit').value = String(state.schedule.unit);
    return;
  }

  state.schedule = { start: start, end: end, unit: unit };
  var rows = scheduleRows();
  var anyRealigned = false;
  state.classes.forEach(function (cls) {
    if (rows.length && rows.indexOf(cls.startMinutes) === -1) {
      anyRealigned = true;
      cls.startMinutes = rows.reduce(function (prev, cur) {
        return Math.abs(cur - cls.startMinutes) < Math.abs(prev - cls.startMinutes) ? cur : prev;
      }, rows[0]);
    }
  });

  persistLocal();
  renderGrid();
  toast(anyRealigned
    ? '表示時間を変更しました(一部の授業の位置がずれた可能性があるのでご確認ください)'
    : '表示時間を変更しました');
}

document.getElementById('schedStart').addEventListener('change', applyScheduleChange);
document.getElementById('schedEnd').addEventListener('change', applyScheduleChange);
document.getElementById('schedUnit').addEventListener('change', applyScheduleChange);

/* ---------- Days management ---------- */

function renderDaysList() {
  var ul = document.getElementById('daysList');
  ul.innerHTML = '';
  state.days.forEach(function (day) {
    var li = document.createElement('li');
    var label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = day.active;
    cb.addEventListener('change', function () {
      day.active = cb.checked;
      persistLocal(); renderGrid();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(day.label));
    li.appendChild(label);
    ul.appendChild(li);
  });
}

/* ---------- Save / Open / PDF ---------- */

function downloadBlob(data, filename) {
  var blob = new Blob([data], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function saveToFile(forceNew) {
  var data = JSON.stringify(state, null, 2);
  if ('showSaveFilePicker' in window) {
    try {
      if (!fileHandle || forceNew) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: sanitizeFileName(state.title) + '.json',
          types: [{ description: '時間割データ', accept: { 'application/json': ['.json'] } }]
        });
      }
      var writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      toast('保存しました');
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('保存に失敗しました'); }
    }
  } else {
    downloadBlob(data, sanitizeFileName(state.title) + '.json');
    toast('ファイルをダウンロードしました');
  }
}

function loadStateFromJSON(text) {
  try {
    var parsed = JSON.parse(text);
    state = normalizeState(parsed);
    render();
    persistLocal();
    toast('読み込みました');
  } catch (e) {
    toast('ファイルの形式が正しくありません');
  }
}

async function openFromFile() {
  if ('showOpenFilePicker' in window) {
    try {
      var handles = await window.showOpenFilePicker({
        types: [{ description: '時間割データ', accept: { 'application/json': ['.json'] } }]
      });
      fileHandle = handles[0];
      var file = await fileHandle.getFile();
      var text = await file.text();
      loadStateFromJSON(text);
    } catch (e) {
      if (e.name !== 'AbortError') toast('読み込みに失敗しました');
    }
  } else {
    document.getElementById('fileInput').click();
  }
}

function exportPdf() {
  window.print();
}

/* ---------- Zoom ---------- */

var zoomLevel = 1;
var ZOOM_MIN = 0.6;
var ZOOM_MAX = 1.6;
var ZOOM_STEP = 0.1;

function applyZoom() {
  document.getElementById('gridTopWrap').style.zoom = zoomLevel;
  document.getElementById('gridBottomWrap').style.zoom = zoomLevel;
  document.getElementById('zoomLabel').textContent = Math.round(zoomLevel * 100) + '%';
}

document.getElementById('btnZoomIn').addEventListener('click', function () {
  zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
  applyZoom();
});
document.getElementById('btnZoomOut').addEventListener('click', function () {
  zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
  applyZoom();
});
document.getElementById('btnZoomReset').addEventListener('click', function () {
  zoomLevel = 1;
  applyZoom();
});

/* ---------- Image export (画像で保存) ----------
   Drawn directly onto a <canvas> from the schedule data, rather than rasterizing
   the live DOM: a foreignObject-based SVG snapshot taints the canvas in Chromium
   (drawImage succeeds but toBlob/toDataURL then throw a SecurityError), so DOM
   cloning can't be used here. Native canvas 2D drawing never taints. */

var CATEGORY_COLOR = { elementary: '#6fd39a', middle: '#7fb0f5', high: '#ffab77', other: '#a99bd6' };
var IMG_FONT = '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';
var IMG_TIME_COL_WIDTH = 64;
var IMG_ROOM_COL_WIDTH = 136;
var IMG_ROW_HEIGHT = 78;
var IMG_DAY_HEADER_HEIGHT = 30;
var IMG_ROOM_HEADER_HEIGHT = 26;

function roundRectPath(ctx, x, y, w, h, r) {
  var rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillTextEllipsis(ctx, text, x, y, maxWidth) {
  if (maxWidth <= 0) return;
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  var t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  ctx.fillText(t + '…', x, y);
}

function buildDayRoomPlacements(days, rooms, rows) {
  var map = {};
  days.forEach(function (day) {
    rooms.forEach(function (room) {
      var list = [];
      var consumedUntil = 0;
      rows.forEach(function (rowStartMin, rowIdx) {
        if (rowIdx < consumedUntil) return;
        var cls = state.classes.find(function (c) {
          return c.dayId === day.id && c.roomId === room.id && c.startMinutes === rowStartMin;
        });
        if (cls) {
          var tmpl = state.catalog.find(function (t) { return t.id === cls.templateId; });
          var span = Math.min(templateSpan(tmpl), rows.length - rowIdx);
          list.push({ rowIdx: rowIdx, span: span, cls: cls, tmpl: tmpl });
          consumedUntil = rowIdx + span;
        } else {
          consumedUntil = rowIdx + 1;
        }
      });
      map[day.id + '|' + room.id] = list;
    });
  });
  return map;
}

function drawClassCell(ctx, placement, x, y, w, h) {
  var tmpl = placement.tmpl;
  if (!tmpl) return;
  var subject = state.subjects.find(function (s) { return s.id === tmpl.subjectId; });
  var c = subject ? SUBJECT_COLOR_MAP[subject.color] : null;
  var bg = c ? c.bg : '#eef0f2';
  var border = c ? c.border : '#c7ccd1';
  var textColor = c ? c.text : '#51565c';

  roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, 12);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = border;
  ctx.stroke();

  var innerX = x + 10;
  var maxTextWidth = (x + w - 8) - innerX;
  var lineY = y + 9;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  var dotX = innerX;
  templateCategories(tmpl).forEach(function (cat) {
    ctx.fillStyle = CATEGORY_COLOR[cat] || '#a9b0b8';
    ctx.beginPath();
    ctx.arc(dotX + 4, lineY + 6, 4, 0, Math.PI * 2);
    ctx.fill();
    dotX += 11;
  });
  ctx.fillStyle = textColor;
  ctx.font = 'bold 12px ' + IMG_FONT;
  var duration = tmpl.duration || DEFAULT_DURATION;
  var gradeText = gradesLabel(getTemplateGrades(tmpl)) + ' ・ ' + duration + '分';
  fillTextEllipsis(ctx, gradeText, dotX, lineY, maxTextWidth - (dotX - innerX));
  lineY += 17;

  var subjectName = subject ? subject.name : '(科目未設定)';
  ctx.font = 'bold 15px ' + IMG_FONT;
  fillTextEllipsis(ctx, subjectName, innerX, lineY, maxTextWidth);
  lineY += 20;

  var metaParts = [];
  if (tmpl.teacher) metaParts.push('👤 ' + tmpl.teacher);
  if (tmpl.note) metaParts.push(tmpl.note);
  if (metaParts.length && lineY + 15 <= y + h - 17) {
    ctx.font = '12px ' + IMG_FONT;
    ctx.globalAlpha = 0.85;
    fillTextEllipsis(ctx, metaParts.join(' ・ '), innerX, lineY, maxTextWidth);
    ctx.globalAlpha = 1;
  }

  var timeLabel = classTimeRangeLabel(placement.cls, tmpl);
  ctx.font = 'bold 11px ' + IMG_FONT;
  ctx.globalAlpha = 0.75;
  ctx.textBaseline = 'bottom';
  fillTextEllipsis(ctx, timeLabel, innerX, y + h - 7, maxTextWidth);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'top';
}

function drawGridSection(ctx, opts) {
  var days = opts.days, rooms = opts.rooms, rows = opts.rows, x0 = opts.x, y0 = opts.y;
  var colWidth = IMG_ROOM_COL_WIDTH;
  var headerHeight = IMG_DAY_HEADER_HEIGHT + IMG_ROOM_HEADER_HEIGHT;
  var bodyY = y0 + headerHeight;
  var placements = buildDayRoomPlacements(days, rooms, rows);

  var x = x0 + IMG_TIME_COL_WIDTH;
  days.forEach(function (day) {
    var w = rooms.length * colWidth;
    var grad = ctx.createLinearGradient(x, y0, x + w, y0);
    grad.addColorStop(0, '#ffe1ee');
    grad.addColorStop(1, '#e2ecff');
    roundRectPath(ctx, x + 2, y0, w - 4, IMG_DAY_HEADER_HEIGHT - 2, 10);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = '#6a5b9c';
    ctx.font = 'bold 14px ' + IMG_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(day.label, x + w / 2, y0 + IMG_DAY_HEADER_HEIGHT / 2);
    x += w;
  });

  x = x0 + IMG_TIME_COL_WIDTH;
  var ry = y0 + IMG_DAY_HEADER_HEIGHT;
  days.forEach(function () {
    rooms.forEach(function (room) {
      roundRectPath(ctx, x + 2, ry, colWidth - 4, IMG_ROOM_HEADER_HEIGHT - 2, 8);
      ctx.fillStyle = '#f4f1fc';
      ctx.fill();
      ctx.fillStyle = '#9a93ac';
      ctx.font = 'bold 12px ' + IMG_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fillTextEllipsis(ctx, room.name, x + colWidth / 2, ry + IMG_ROOM_HEADER_HEIGHT / 2, colWidth - 12);
      x += colWidth;
    });
  });

  rows.forEach(function (rowStartMin, rowIdx) {
    var cellY = bodyY + rowIdx * IMG_ROW_HEIGHT;
    var isHour = rowStartMin % 60 === 0;
    roundRectPath(ctx, x0 + 2, cellY, IMG_TIME_COL_WIDTH - 4, IMG_ROW_HEIGHT - 2, 8);
    ctx.fillStyle = isHour ? '#eee9fd' : '#f7f4fd';
    ctx.fill();
    ctx.fillStyle = isHour ? '#7666e8' : '#9a93ac';
    ctx.font = (isHour ? 'bold 12px ' : '11px ') + IMG_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(minutesToTime(rowStartMin), x0 + IMG_TIME_COL_WIDTH / 2, cellY + IMG_ROW_HEIGHT / 2);
  });

  x = x0 + IMG_TIME_COL_WIDTH;
  days.forEach(function (day) {
    rooms.forEach(function (room) {
      var list = placements[day.id + '|' + room.id] || [];
      var startAt = {};
      var covered = {};
      list.forEach(function (p) {
        startAt[p.rowIdx] = p;
        for (var i = 1; i < p.span; i++) covered[p.rowIdx + i] = true;
      });
      for (var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        if (covered[rowIdx]) continue;
        var cellY = bodyY + rowIdx * IMG_ROW_HEIGHT;
        var p = startAt[rowIdx];
        if (p) {
          drawClassCell(ctx, p, x, cellY, colWidth, IMG_ROW_HEIGHT * p.span);
        } else {
          roundRectPath(ctx, x + 2, cellY, colWidth - 4, IMG_ROW_HEIGHT - 2, 10);
          ctx.fillStyle = '#fbfaff';
          ctx.fill();
        }
      }
      x += colWidth;
    });
  });

  return y0 + headerHeight + rows.length * IMG_ROW_HEIGHT;
}

function exportImage() {
  var activeDays = state.days.filter(function (d) { return d.active; });
  if (!activeDays.length) { toast('表示する曜日がありません'); return; }
  var topDays = activeDays.slice(0, TOP_ROW_MAX_DAYS);
  var bottomDays = activeDays.slice(TOP_ROW_MAX_DAYS);
  var rooms = state.rooms.length ? state.rooms : [{ id: '__none__', name: '(教室未設定)' }];
  var rows = scheduleRows();

  var sectionWidthOf = function (days) { return IMG_TIME_COL_WIDTH + days.length * rooms.length * IMG_ROOM_COL_WIDTH; };
  var sectionHeight = IMG_DAY_HEADER_HEIGHT + IMG_ROOM_HEADER_HEIGHT + rows.length * IMG_ROW_HEIGHT;
  var padding = 20;
  var titleHeight = 34;
  var sectionGap = 18;

  var contentWidth = Math.max(sectionWidthOf(topDays), bottomDays.length ? sectionWidthOf(bottomDays) : 0) + padding * 2;
  var contentHeight = padding * 2 + titleHeight + sectionHeight + (bottomDays.length ? sectionGap + sectionHeight : 0);

  var scale = 2;
  var canvas = document.createElement('canvas');
  canvas.width = Math.ceil(contentWidth * scale);
  canvas.height = Math.ceil(contentHeight * scale);
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, contentWidth, contentHeight);

  ctx.fillStyle = '#22262b';
  ctx.font = 'bold 20px ' + IMG_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(state.title, padding, padding);

  var y = padding + titleHeight;
  y = drawGridSection(ctx, { days: topDays, rooms: rooms, rows: rows, x: padding, y: y });
  if (bottomDays.length) {
    y += sectionGap;
    drawGridSection(ctx, { days: bottomDays, rooms: rooms, rows: rows, x: padding, y: y });
  }

  canvas.toBlob(function (blob) {
    if (!blob) { toast('画像の書き出しに失敗しました'); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sanitizeFileName(state.title) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('画像を保存しました');
  }, 'image/png');
}

/* ---------- Wire up static UI ---------- */

document.getElementById('titleInput').addEventListener('input', function (e) {
  state.title = e.target.value;
  document.getElementById('printTitle').textContent = state.title;
  persistLocal();
});

document.getElementById('btnCatalog').addEventListener('click', function () { pendingCell = null; newCatGrades = []; openCatalogModal(); });
document.getElementById('btnNewFromPicker').addEventListener('click', function () { newCatGrades = []; openCatalogModal(); });
document.getElementById('btnManageRooms').addEventListener('click', function () { renderRoomsList(); showModal('roomsModal'); });
document.getElementById('btnSubjects').addEventListener('click', openSubjectsModal);
document.getElementById('btnSchedule').addEventListener('click', openScheduleModal);
document.getElementById('btnManageDays').addEventListener('click', function () { renderDaysList(); showModal('daysModal'); });
document.getElementById('btnHelp').addEventListener('click', function () { showModal('helpModal'); });

document.getElementById('btnOpen').addEventListener('click', openFromFile);
document.getElementById('btnSave').addEventListener('click', function () { saveToFile(false); });
document.getElementById('btnSaveAs').addEventListener('click', function () { saveToFile(true); });
document.getElementById('btnPdf').addEventListener('click', exportPdf);
document.getElementById('btnSaveImage').addEventListener('click', exportImage);

document.getElementById('btnReset').addEventListener('click', function () {
  if (confirm('現在の時間割データを削除して新規作成します。保存していない変更は失われますがよろしいですか？')) {
    state = defaultState();
    fileHandle = null;
    persistLocal();
    render();
  }
});

document.querySelectorAll('.btn-close-modal').forEach(function (btn) {
  btn.addEventListener('click', closeModals);
});

document.getElementById('modalOverlay').addEventListener('click', function (e) {
  if (e.target.id === 'modalOverlay') closeModals();
});
document.querySelectorAll('.modal').forEach(function (m) {
  m.addEventListener('click', function (e) { e.stopPropagation(); });
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModals();
});

document.getElementById('fileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () { loadStateFromJSON(reader.result); };
  reader.readAsText(file);
  e.target.value = '';
});

document.querySelectorAll('#legend input[type="checkbox"]').forEach(function (cb) {
  cb.addEventListener('change', function () {
    filter[cb.dataset.cat] = cb.checked;
    renderGrid();
  });
});

/* ---------- Init ---------- */

function init() {
  var saved = null;
  try { saved = localStorage.getItem(LS_KEY); } catch (e) { /* ignore */ }
  if (saved) {
    try { state = normalizeState(JSON.parse(saved)); } catch (e) { state = defaultState(); }
  } else {
    state = defaultState();
  }
  render();
}

init();
