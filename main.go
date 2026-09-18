package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

func mustSub(f embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		log.Fatalf("嵌入资源错误: %v", err)
	}
	return sub
}

//go:embed static
var staticFS embed.FS

// 所有时间统一使用 UTC+8 时区
var tz = time.FixedZone("Asia-Shanghai", 8*3600)

// 时段定义
var slotKeys = []string{"breakfast", "lunch", "afternoon", "dinner", "late"}

var db *sql.DB

var (
	sessionsMu sync.Mutex
	sessions   = map[string]time.Time{} // token -> 过期时间
)

type Dish struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	HasPhoto bool     `json:"hasPhoto"`
	Options  []string `json:"options"`
	Slots    []string `json:"slots"`
}

type OrderItem struct {
	ID        int64    `json:"id"`
	DishID    int64    `json:"dishId"`
	Name      string   `json:"name"`
	HasPhoto  bool     `json:"hasPhoto"`
	Options   []string `json:"options"`
	Qty       int      `json:"qty"`
	UpdatedAt string   `json:"updatedAt"`
}

// ---------------- 工具函数 ----------------

func nowStr() string {
	return time.Now().In(tz).Format("2006-01-02 15:04:05")
}

func todayStr() string {
	return time.Now().In(tz).Format("2006-01-02")
}

func jsonWrite(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errWrite(w http.ResponseWriter, code int, msg string) {
	jsonWrite(w, code, map[string]string{"error": msg})
}

func validSlot(s string) bool {
	for _, k := range slotKeys {
		if k == s {
			return true
		}
	}
	return false
}

func validDate(s string) bool {
	_, err := time.ParseInLocation("2006-01-02", s, tz)
	return err == nil
}

func hashPassword(pw, salt string) string {
	h := sha256.Sum256([]byte(pw + ":" + salt))
	return hex.EncodeToString(h[:])
}

func newToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func getMeta(key string) (string, bool) {
	var v string
	err := db.QueryRow("SELECT v FROM meta WHERE k = ?", key).Scan(&v)
	if err != nil {
		return "", false
	}
	return v, true
}

func setMeta(key, val string) {
	_, _ = db.Exec("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, val)
}

func isChef(r *http.Request) bool {
	c, err := r.Cookie("chef_session")
	if err != nil || c.Value == "" {
		return false
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	exp, ok := sessions[c.Value]
	if !ok || time.Now().After(exp) {
		delete(sessions, c.Value)
		return false
	}
	return true
}

func requireChef(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isChef(r) {
			errWrite(w, http.StatusUnauthorized, "请先登录厨师账号")
			return
		}
		next(w, r)
	}
}

func parseJSONStrings(s string) []string {
	var arr []string
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		v = strings.TrimSpace(v)
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func filterSlots(arr []string) []string {
	hasAll := false
	seen := map[string]bool{}
	out := []string{}
	for _, s := range arr {
		if s == "all" {
			hasAll = true
			continue
		}
		if validSlot(s) && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if hasAll {
		return []string{"all"}
	}
	return out
}

// slotsEffective 返回菜品实际生效的时段列表
func slotsEffective(slots []string) []string {
	for _, s := range slots {
		if s == "all" {
			return slotKeys
		}
	}
	return slots
}

// ---------------- API 处理 ----------------

func apiState(w http.ResponseWriter, r *http.Request) {
	_, hasPw := getMeta("chef_hash")
	jsonWrite(w, 200, map[string]interface{}{
		"hasPassword": hasPw,
		"chefAuthed":  isChef(r),
		"today":       todayStr(),
		"weekdays":    map[string]string{},
	})
}

func apiChefSetup(w http.ResponseWriter, r *http.Request) {
	if _, has := getMeta("chef_hash"); has {
		errWrite(w, 400, "密码已设置，请直接登录")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Password) < 4 {
		errWrite(w, 400, "密码至少需要 4 个字符")
		return
	}
	salt := newToken()
	setMeta("chef_salt", salt)
	setMeta("chef_hash", hashPassword(req.Password, salt))
	issueSession(w)
	jsonWrite(w, 200, map[string]bool{"ok": true})
}

func apiChefLogin(w http.ResponseWriter, r *http.Request) {
	salt, ok1 := getMeta("chef_salt")
	hash, ok2 := getMeta("chef_hash")
	if !ok1 || !ok2 {
		errWrite(w, 400, "尚未设置密码")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errWrite(w, 400, "请求格式错误")
		return
	}
	if hashPassword(req.Password, salt) != hash {
		errWrite(w, 401, "密码不正确，请重试")
		return
	}
	issueSession(w)
	jsonWrite(w, 200, map[string]bool{"ok": true})
}

func issueSession(w http.ResponseWriter) {
	token := newToken()
	sessionsMu.Lock()
	sessions[token] = time.Now().Add(7 * 24 * time.Hour)
	sessionsMu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     "chef_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   7 * 24 * 3600,
	})
}

func apiChefLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("chef_session"); err == nil {
		sessionsMu.Lock()
		delete(sessions, c.Value)
		sessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "chef_session", Value: "", Path: "/", MaxAge: -1})
	jsonWrite(w, 200, map[string]bool{"ok": true})
}

// dishForm 从 multipart 表单解析菜品数据
func dishForm(r *http.Request) (name string, options []string, slots []string, photo []byte, hasPhoto bool, err error) {
	if err = r.ParseMultipartForm(20 << 20); err != nil {
		return
	}
	name = strings.TrimSpace(r.FormValue("name"))
	options = parseJSONStrings(r.FormValue("options"))
	slots = filterSlots(parseJSONStrings(r.FormValue("slots")))
	if len(slots) == 0 {
		slots = []string{"all"}
	}
	file, header, e := r.FormFile("photo")
	if e == nil && header.Size > 0 {
		defer file.Close()
		photo, err = io.ReadAll(io.LimitReader(file, 10<<20))
		if err != nil {
			return
		}
		hasPhoto = true
	}
	return
}

func apiDishes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query("SELECT id, name, options, slots, CASE WHEN photo IS NOT NULL AND LENGTH(photo) > 0 THEN 1 ELSE 0 END FROM dishes WHERE deleted = 0 ORDER BY id DESC")
		if err != nil {
			errWrite(w, 500, "数据库错误")
			return
		}
		defer rows.Close()
		list := []Dish{}
		for rows.Next() {
			var d Dish
			var opt, sl string
			if err := rows.Scan(&d.ID, &d.Name, &opt, &sl, &d.HasPhoto); err != nil {
				continue
			}
			d.Options = parseJSONStrings(opt)
			d.Slots = parseJSONStrings(sl)
			list = append(list, d)
		}
		jsonWrite(w, 200, map[string]interface{}{"dishes": list})

	case http.MethodPost: // 新增菜品（需厨师登录）
		if !isChef(r) {
			errWrite(w, 401, "请先登录厨师账号")
			return
		}
		name, options, slots, photo, hasPhoto, err := dishForm(r)
		if err != nil || name == "" {
			errWrite(w, 400, "请填写菜品名称")
			return
		}
		optJSON, _ := json.Marshal(options)
		slotJSON, _ := json.Marshal(slots)
		var photoArg interface{}
		if hasPhoto {
			photoArg = photo
		}
		res, err := db.Exec("INSERT INTO dishes(name, photo, options, slots, deleted, created_at) VALUES(?, ?, ?, ?, 0, ?)",
			name, photoArg, string(optJSON), string(slotJSON), nowStr())
		if err != nil {
			errWrite(w, 500, "保存失败")
			return
		}
		id, _ := res.LastInsertId()
		jsonWrite(w, 200, map[string]interface{}{"ok": true, "id": id})

	default:
		errWrite(w, 405, "不支持的请求方法")
	}
}

func apiDishByID(w http.ResponseWriter, r *http.Request) {
	if !isChef(r) {
		errWrite(w, 401, "请先登录厨师账号")
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/dishes/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		errWrite(w, 400, "菜品 ID 无效")
		return
	}

	switch r.Method {
	case http.MethodPut: // 编辑菜品
		name, options, slots, photo, hasPhoto, err := dishForm(r)
		if err != nil || name == "" {
			errWrite(w, 400, "请填写菜品名称")
			return
		}
		optJSON, _ := json.Marshal(options)
		slotJSON, _ := json.Marshal(slots)
		if hasPhoto {
			_, err = db.Exec("UPDATE dishes SET name=?, photo=?, options=?, slots=? WHERE id=?", name, photo, string(optJSON), string(slotJSON), id)
		} else {
			_, err = db.Exec("UPDATE dishes SET name=?, options=?, slots=? WHERE id=?", name, string(optJSON), string(slotJSON), id)
		}
		if err != nil {
			errWrite(w, 500, "保存失败")
			return
		}
		jsonWrite(w, 200, map[string]bool{"ok": true})

	case http.MethodDelete: // 删除菜品（软删除，历史订单仍可显示）
		if _, err := db.Exec("UPDATE dishes SET deleted = 1 WHERE id=?", id); err != nil {
			errWrite(w, 500, "删除失败")
			return
		}
		jsonWrite(w, 200, map[string]bool{"ok": true})

	default:
		errWrite(w, 405, "不支持的请求方法")
	}
}

func apiPhoto(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/photo/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		errWrite(w, 400, "ID 无效")
		return
	}
	var photo []byte
	if err := db.QueryRow("SELECT photo FROM dishes WHERE id=?", id).Scan(&photo); err != nil || len(photo) == 0 {
		errWrite(w, 404, "照片不存在")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(photo))
	w.Header().Set("Cache-Control", "max-age=3600")
	_, _ = w.Write(photo)
}

// apiOrders GET ?date=YYYY-MM-DD 查询某天订单；PUT 设置某天某时段的订单
func apiOrders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		date := r.URL.Query().Get("date")
		if !validDate(date) {
			date = todayStr()
		}
		rows, err := db.Query(`SELECT o.id, o.slot, o.dish_id, o.options, o.qty, o.updated_at, d.name,
			CASE WHEN d.photo IS NOT NULL AND LENGTH(d.photo) > 0 THEN 1 ELSE 0 END FROM orders o JOIN dishes d ON d.id = o.dish_id WHERE o.date = ? ORDER BY o.id`, date)
		if err != nil {
			errWrite(w, 500, "数据库错误")
			return
		}
		defer rows.Close()
		slotsMap := map[string][]OrderItem{}
		for rows.Next() {
			var it OrderItem
			var slot, opt string
			if err := rows.Scan(&it.ID, &slot, &it.DishID, &opt, &it.Qty, &it.UpdatedAt, &it.Name, &it.HasPhoto); err != nil {
				continue
			}
			it.Options = parseJSONStrings(opt)
			slotsMap[slot] = append(slotsMap[slot], it)
		}
		jsonWrite(w, 200, map[string]interface{}{"date": date, "slots": slotsMap})

	case http.MethodPut:
		var req struct {
			Date string `json:"date"`
			Slot string `json:"slot"`
			Items []struct {
				DishID  int64    `json:"dishId"`
				Options []string `json:"options"`
				Qty     int      `json:"qty"`
			} `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			errWrite(w, 400, "请求格式错误")
			return
		}
		if !validDate(req.Date) {
			errWrite(w, 400, "日期格式无效")
			return
		}
		if !validSlot(req.Slot) {
			errWrite(w, 400, "时段无效")
			return
		}
		for _, it := range req.Items {
			if it.Qty < 1 || it.Qty > 99 {
				errWrite(w, 400, "数量必须在 1-99 之间")
				return
			}
			var exist int
			if err := db.QueryRow("SELECT COUNT(*) FROM dishes WHERE id=? AND deleted=0", it.DishID).Scan(&exist); err != nil || exist == 0 {
				errWrite(w, 400, "菜品不存在")
				return
			}
		}
		tx, err := db.Begin()
		if err != nil {
			errWrite(w, 500, "数据库错误")
			return
		}
		defer tx.Rollback()
		if _, err := tx.Exec("DELETE FROM orders WHERE date=? AND slot=?", req.Date, req.Slot); err != nil {
			errWrite(w, 500, "保存失败")
			return
		}
		now := nowStr()
		for _, it := range req.Items {
			optJSON, _ := json.Marshal(it.Options)
			if _, err := tx.Exec("INSERT INTO orders(date, slot, dish_id, options, qty, updated_at) VALUES(?,?,?,?,?,?)",
				req.Date, req.Slot, it.DishID, string(optJSON), it.Qty, now); err != nil {
				errWrite(w, 500, "保存失败")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			errWrite(w, 500, "保存失败")
			return
		}
		jsonWrite(w, 200, map[string]bool{"ok": true})

	default:
		errWrite(w, 405, "不支持的请求方法")
	}
}

// apiOrderDates GET ?month=YYYY-MM 返回每天订单数（用于顾客日历标记）
func apiOrderDates(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if m, err := time.Parse("2006-01", month); err != nil {
		month = time.Now().In(tz).Format("2006-01")
		_ = m
	}
	rows, err := db.Query("SELECT date, COUNT(*) FROM orders WHERE date LIKE ? GROUP BY date", month+"%")
	if err != nil {
		errWrite(w, 500, "数据库错误")
		return
	}
	defer rows.Close()
	dates := map[string]int{}
	for rows.Next() {
		var d string
		var c int
		if err := rows.Scan(&d, &c); err == nil {
			dates[d] = c
		}
	}
	jsonWrite(w, 200, map[string]interface{}{"dates": dates})
}

// apiChanges GET 查询厨师上次查看之后有变动的日期；POST 标记已读
func apiChanges(w http.ResponseWriter, r *http.Request) {
	if !isChef(r) {
		errWrite(w, 401, "请先登录厨师账号")
		return
	}
	switch r.Method {
	case http.MethodGet:
		seen := "2000-01-01 00:00:00"
		if v, ok := getMeta("chef_seen"); ok {
			seen = v
		}
		rows, err := db.Query("SELECT DISTINCT date FROM orders WHERE updated_at > ? ORDER BY date", seen)
		if err != nil {
			errWrite(w, 500, "数据库错误")
			return
		}
		defer rows.Close()
		dates := []string{}
		for rows.Next() {
			var d string
			if err := rows.Scan(&d); err == nil {
				dates = append(dates, d)
			}
		}
		jsonWrite(w, 200, map[string]interface{}{"dates": dates, "seen": seen})

	case http.MethodPost: // 标记全部已读
		setMeta("chef_seen", nowStr())
		jsonWrite(w, 200, map[string]bool{"ok": true})

	default:
		errWrite(w, 405, "不支持的请求方法")
	}
}

// ---------------- 启动 ----------------

func openDB(path string) {
	var err error
	// 先用默认（WAL 较安全）建立连接，目的是处理可能存在的旧 WAL 残留
	db, err = sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?_pragma=busy_timeout(10000)")
	if err != nil {
		log.Fatalf("open db failed: %v", err)
	}
	schema := `
	CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
	CREATE TABLE IF NOT EXISTS dishes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		photo BLOB,
		options TEXT NOT NULL DEFAULT '[]',
		slots TEXT NOT NULL DEFAULT '[]',
		deleted INTEGER NOT NULL DEFAULT 0,
		created_at TEXT
	);
	CREATE TABLE IF NOT EXISTS orders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		date TEXT NOT NULL,
		slot TEXT NOT NULL,
		dish_id INTEGER NOT NULL,
		options TEXT NOT NULL DEFAULT '[]',
		qty INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
	CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(date, slot);
	`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("init schema failed: %v", err)
	}

	// 把任何遗留的 -wal 内容合并回主库，并切换到 DELETE 日志模式 → 整个数据库只有单文件
	if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err == nil {
		if _, err := db.Exec("PRAGMA journal_mode=DELETE"); err == nil {
			os.Remove(path + "-wal")
			os.Remove(path + "-shm")
			log.Printf("database in single-file mode: %s", path)
		}
	}
}

func main() {
	// 端口参数解析：支持 port=18888 / -port=18888 / --port 18888
	port := 18888
	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		t := strings.TrimLeft(args[i], "-")
		if strings.HasPrefix(t, "port=") {
			if p, err := strconv.Atoi(t[len("port="):]); err == nil && p > 0 && p < 65536 {
				port = p
			}
		} else if t == "port" && i+1 < len(args) {
			if p, err := strconv.Atoi(args[i+1]); err == nil && p > 0 && p < 65536 {
				port = p
			}
		}
	}

	// 确定可执行文件所在目录（数据库和日志文件都放在这里，方便整体迁移）
	exeDir := "."
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if !strings.Contains(dir, "go-build") {
			exeDir = dir
		}
	}

	// ---- 日志文件 ----
	logPath := filepath.Join(exeDir, "food_order.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		log.Fatalf("cannot open log file %s: %v", logPath, err)
	}
	defer logFile.Close()
	// 同时写文件和标准输出（方便终端也能看到）
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))
	log.SetFlags(log.Ldate | log.Ltime)

	dbPath := filepath.Join(exeDir, "food_data.db")
	openDB(dbPath)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", apiState)
	mux.HandleFunc("/api/chef/setup", apiChefSetup)
	mux.HandleFunc("/api/chef/login", apiChefLogin)
	mux.HandleFunc("/api/chef/logout", apiChefLogout)
	mux.HandleFunc("/api/dishes", apiDishes)
	mux.HandleFunc("/api/dishes/", requireChef(apiDishByID))
	mux.HandleFunc("/api/photo/", apiPhoto)
	mux.HandleFunc("/api/orders", apiOrders)
	mux.HandleFunc("/api/orders/dates", apiOrderDates)
	mux.HandleFunc("/api/changes", apiChanges)

	mux.Handle("/static/", http.StripPrefix("/static/",
		http.FileServer(http.FS(mustSub(staticFS, "static")))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		data, err := staticFS.ReadFile("static/index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
	})

	log.Printf("Food Order Hut is running. DB: %s  Log: %s", dbPath, logPath)
	url := fmt.Sprintf("http://localhost:%d", port)
	log.Printf("Open in browser: %s  (CLI arg: port=%d)", url, port)

	// 自动打开默认浏览器（Windows 双击 exe 场景）
	go func() {
		time.Sleep(500 * time.Millisecond) // 等服务器就绪
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "windows":
			cmd = exec.Command("cmd", "/c", "start", url)
		case "darwin":
			cmd = exec.Command("open", url)
		default: // linux 等
			cmd = exec.Command("xdg-open", url)
		}
		if err := cmd.Start(); err != nil {
			log.Printf("auto-open browser failed: %v (please open %s manually)", err, url)
		}
	}()

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
