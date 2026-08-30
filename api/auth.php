<?php
declare(strict_types=1);

const ROLES = ['teacher', 'student'];
const PASSWORD_MIN_LENGTH = 8;

$secureCookie = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $secureCookie,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

try {
    $action = $_GET['action'] ?? '';
    if (!is_string($action) || $action === '') {
        respond(400, ['message' => 'Nie podano akcji.']);
    }

    match ($action) {
        'register' => register(),
        'login' => login(),
        'me' => currentAccount(),
        'logout' => logout(),
        'class' => getMyClass(),
        'regenerate-key' => regenerateClassKey(),
        'students' => listStudents(),
        'add-grade' => addGrade(),
        'remove-student' => removeStudent(),
        'pending-grades' => pendingGrades(),
        'generate-invite' => generateInvite(),
        'generate-qr-invite' => generateQrInvite(),
        'delete-qr-invite' => deleteQrInvite(),
        'list-invites' => listInvites(),
        'delete-invite' => deleteInvite(),
        'create-class' => createClass(),
        'settle-grades' => settleGrades(),
        'list-classes' => listClasses(),
        'update-display-name' => updateDisplayName(),
        'request-name-change' => requestNameChange(),
        'list-name-requests' => listNameRequests(),
        'decide-name-request' => decideNameRequest(),
        'list-characters' => listCharacters(),
        'set-character' => setCharacter(),
        'my-name-request' => myNameRequest(),
        'delete-class' => deleteClass(),
        default => respond(404, ['message' => 'Nieznana akcja.']),
    };
} catch (Throwable $exception) {
    $errorId = bin2hex(random_bytes(4));
    error_log(sprintf('[%s] %s in %s:%d\n%s', $errorId, $exception->getMessage(), $exception->getFile(), $exception->getLine(), $exception->getTraceAsString()));
    respond(500, [
        'message' => 'Wystąpił błąd serwera.',
        'errorId' => $errorId,
        'error' => $exception->getMessage(),
    ]);
}

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requirePostMethod(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda POST.']);
    }
}

function readJsonBody(): array
{
    requirePostMethod();
    $rawBody = file_get_contents('php://input') ?: '';
    $data = json_decode($rawBody, true);
    if (!is_array($data)) {
        respond(400, ['message' => 'Nieprawidłowy format JSON.']);
    }
    return $data;
}

function createMysqlDsn(string $host, string $port, string $socket, ?string $database = null): string
{
    $parts = $socket !== '' ? ['unix_socket=' . $socket] : ['host=' . $host, 'port=' . $port];
    if ($database !== null) {
        $parts[] = 'dbname=' . $database;
    }
    $parts[] = 'charset=utf8mb4';
    return 'mysql:' . implode(';', $parts);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    // SQLite — plik w folderze projektu, przenośny (XAMPP Apache wystarczy, MySQL niepotrzebny)
    // Ścieżkę można nadpisać env ZOLWIE_DB_SQLITE
    $sqliteFile = getenv('ZOLWIE_DB_SQLITE') ?: __DIR__ . '/../database.sqlite';
    $dir = dirname($sqliteFile);
    if (!is_dir($dir) && $dir !== '' && $dir !== '.') {
        mkdir($dir, 0777, true);
    }

    // Fallback na MySQL jeśli ustawiono ZOLWIE_DB_HOST (dla kompatybilności)
    $useMysql = getenv('ZOLWIE_DB_HOST') !== false && getenv('ZOLWIE_DB_HOST') !== '';
    if ($useMysql) {
        $host = getenv('ZOLWIE_DB_HOST') ?: 'localhost';
        $port = getenv('ZOLWIE_DB_PORT') ?: '3306';
        $socket = getenv('ZOLWIE_DB_SOCKET') ?: '';
        $database = getenv('ZOLWIE_DB_NAME') ?: 'zolwie';
        $user = getenv('ZOLWIE_DB_USER') ?: 'root';
        $password = getenv('ZOLWIE_DB_PASSWORD') ?: '';
        try {
            $pdo = new PDO(createMysqlDsn($host, $port, $socket, $database), $user, $password, $options);
        } catch (PDOException $exception) {
            $errorInfo = $exception->errorInfo;
            if (!isset($errorInfo[1]) || (int) $errorInfo[1] !== 1049) {
                throw $exception;
            }
            $pdo = new PDO(createMysqlDsn($host, $port, $socket), $user, $password, $options);
            $quoted = str_replace('`', '``', $database);
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$quoted}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("USE `{$quoted}`");
        }
        ensureSchema($pdo);
        return $pdo;
    }

    $pdo = new PDO('sqlite:' . $sqliteFile, null, null, $options);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    ensureSchema($pdo);
    return $pdo;
}

function ensureSchema(PDO $pdo): void
{
    $isSqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';

    if ($isSqlite) {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS klasy (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                name TEXT NOT NULL,
                join_key TEXT NOT NULL UNIQUE,
                created_at DATETIME
            )"
        );
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS uzytkownicy (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                login TEXT NOT NULL UNIQUE,
                haslo TEXT NOT NULL,
                rola TEXT NOT NULL,
                class_id INTEGER,
                data_utworzenia DATETIME,
                FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE SET NULL
            )"
        );
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS oceny (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER NOT NULL,
                student_id INTEGER NOT NULL,
                teacher_id INTEGER NOT NULL,
                rodzaj TEXT NOT NULL CHECK (rodzaj IN ('plus','minus','absent')),
                data_utworzenia DATETIME,
                FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE
            )"
        );
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS invite_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER NOT NULL,
                code TEXT NOT NULL UNIQUE,
                used INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME,
                used_at DATETIME,
                used_by INTEGER,
                FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
                FOREIGN KEY (used_by) REFERENCES uzytkownicy(id) ON DELETE SET NULL
            )"
        );
        // Migration: multi-use QR codes
        try {
            $cols = $pdo->query("PRAGMA table_info(invite_codes)")->fetchAll();
            $hasMulti = false;
            foreach ($cols as $c) { if (($c['name'] ?? '') === 'is_multi') { $hasMulti = true; break; } }
            if (!$hasMulti) {
                $pdo->exec("ALTER TABLE invite_codes ADD COLUMN is_multi INTEGER NOT NULL DEFAULT 0");
            }
        } catch (Throwable $e) {
            try { $pdo->exec("ALTER TABLE invite_codes ADD COLUMN is_multi INTEGER NOT NULL DEFAULT 0"); } catch (Throwable $e2) {}
        }
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS name_change_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                class_id INTEGER NOT NULL,
                old_name TEXT NOT NULL,
                new_name TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
                created_at DATETIME,
                decided_at DATETIME,
                decided_by INTEGER,
                FOREIGN KEY (student_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
                FOREIGN KEY (decided_by) REFERENCES uzytkownicy(id) ON DELETE SET NULL
            )"
        );
        // Migration: character column for race
        try {
            $uCols = $pdo->query("PRAGMA table_info(uzytkownicy)")->fetchAll();
            $hasChar = false;
            foreach ($uCols as $c) { if (($c['name'] ?? '') === 'character') { $hasChar = true; break; } }
            if (!$hasChar) {
                $pdo->exec("ALTER TABLE uzytkownicy ADD COLUMN character TEXT");
            }
        } catch (Throwable $e) {
            try { $pdo->exec("ALTER TABLE uzytkownicy ADD COLUMN character TEXT"); } catch (Throwable $e2) {}
        }
        return;
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS klasy (
            id INT AUTO_INCREMENT PRIMARY KEY,
            teacher_id INT NULL,
            name VARCHAR(120) NOT NULL,
            join_key VARCHAR(24) NOT NULL UNIQUE,
            created_at DATETIME NULL DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS uzytkownicy (
            id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(160) NOT NULL,
            login VARCHAR(80) NOT NULL UNIQUE,
            haslo VARCHAR(255) NOT NULL,
            rola VARCHAR(20) NOT NULL,
            class_id INT NULL,
            data_utworzenia DATETIME NULL DEFAULT NULL,
            CONSTRAINT fk_user_class FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS oceny (
            id INT AUTO_INCREMENT PRIMARY KEY,
            class_id INT NOT NULL,
            student_id INT NOT NULL,
            teacher_id INT NOT NULL,
            rodzaj ENUM('plus','minus','absent') NOT NULL,
            data_utworzenia DATETIME NULL DEFAULT NULL,
            CONSTRAINT fk_grade_class FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
            CONSTRAINT fk_grade_student FOREIGN KEY (student_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE,
            CONSTRAINT fk_grade_teacher FOREIGN KEY (teacher_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS invite_codes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            class_id INT NOT NULL,
            code VARCHAR(24) NOT NULL UNIQUE,
            used TINYINT NOT NULL DEFAULT 0,
            created_at DATETIME NULL DEFAULT NULL,
            used_at DATETIME NULL DEFAULT NULL,
            used_by INT NULL,
            CONSTRAINT fk_invite_class FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
            CONSTRAINT fk_invite_user FOREIGN KEY (used_by) REFERENCES uzytkownicy(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    try {
        $check = $pdo->query("SHOW COLUMNS FROM invite_codes LIKE 'is_multi'");
        if ($check && $check->rowCount() === 0) {
            $pdo->exec("ALTER TABLE invite_codes ADD COLUMN is_multi TINYINT NOT NULL DEFAULT 0");
        }
    } catch (Throwable $e) {
        try { $pdo->exec("ALTER TABLE invite_codes ADD COLUMN is_multi TINYINT NOT NULL DEFAULT 0"); } catch (Throwable $e2) {}
    }
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS name_change_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            class_id INT NOT NULL,
            old_name VARCHAR(160) NOT NULL,
            new_name VARCHAR(160) NOT NULL,
            status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            created_at DATETIME NULL DEFAULT NULL,
            decided_at DATETIME NULL DEFAULT NULL,
            decided_by INT NULL,
            CONSTRAINT fk_ncr_student FOREIGN KEY (student_id) REFERENCES uzytkownicy(id) ON DELETE CASCADE,
            CONSTRAINT fk_ncr_class FOREIGN KEY (class_id) REFERENCES klasy(id) ON DELETE CASCADE,
            CONSTRAINT fk_ncr_decider FOREIGN KEY (decided_by) REFERENCES uzytkownicy(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    try {
        $checkChar = $pdo->query("SHOW COLUMNS FROM uzytkownicy LIKE 'character'");
        if ($checkChar && $checkChar->rowCount() === 0) {
            $pdo->exec("ALTER TABLE uzytkownicy ADD COLUMN character VARCHAR(40) NULL DEFAULT NULL");
        }
    } catch (Throwable $e) {
        try { $pdo->exec("ALTER TABLE uzytkownicy ADD COLUMN character VARCHAR(40) NULL DEFAULT NULL"); } catch (Throwable $e2) {}
    }
}

function textLength(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
}

function passwordMeetsPolicy(string $password): bool
{
    return textLength($password) >= PASSWORD_MIN_LENGTH
        && preg_match('/\p{Ll}/u', $password) === 1
        && preg_match('/\p{Lu}/u', $password) === 1
        && preg_match('/\d/u', $password) === 1;
}

function requireSession(): array
{
    $accountId = $_SESSION['account_id'] ?? null;
    if (!is_int($accountId)) {
        respond(401, ['message' => 'Sesja wygasła. Zaloguj się ponownie.']);
    }
    $statement = db()->prepare('SELECT * FROM uzytkownicy WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $accountId]);
    $account = $statement->fetch();
    if ($account === false) {
        session_destroy();
        respond(401, ['message' => 'Konto nie istnieje.']);
    }
    return $account;
}

function requireCsrfToken(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $session = $_SESSION['csrf_token'] ?? '';
    if (!is_string($sent) || !is_string($session) || $sent === '' || !hash_equals($session, $sent)) {
        respond(403, ['message' => 'Nieprawidłowy token bezpieczeństwa.']);
    }
}

function findUserByLogin(string $login): ?array
{
    $statement = db()->prepare('SELECT * FROM uzytkownicy WHERE login = :login ORDER BY id ASC LIMIT 1');
    $statement->execute(['login' => $login]);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

function publicUser(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'fullName' => (string) $user['full_name'],
        'login' => (string) $user['login'],
        'role' => (string) $user['rola'],
        'classId' => $user['class_id'] === null ? null : (int) $user['class_id'],
        'character' => ($user['character'] ?? null) === null ? null : (string) $user['character'],
    ];
}

function normalizeLogin(string $login): string
{
    return trim($login);
}

function validateNewPassword(string $password, string $confirm): void
{
    if ($password !== $confirm) {
        respond(422, ['message' => 'Hasła nie są identyczne.']);
    }
    if ($password === '') {
        respond(422, ['message' => 'Podaj hasło.']);
    }
}

function generateJoinKey(): string
{
    do {
        $key = mb_strtoupper(bin2hex(random_bytes(4)));
        $exists = db()->prepare('SELECT COUNT(*) FROM klasy WHERE join_key = :key');
        $exists->execute(['key' => $key]);
    } while ((int) $exists->fetchColumn() > 0);
    return $key;
}

function generateInviteCode(): string
{
    do {
        $code = mb_strtoupper(bin2hex(random_bytes(4)));
        $c1 = db()->prepare('SELECT COUNT(*) FROM invite_codes WHERE code = :code');
        $c1->execute(['code' => $code]);
        $c2 = db()->prepare('SELECT COUNT(*) FROM klasy WHERE join_key = :key');
        $c2->execute(['key' => $code]);
    } while ((int) $c1->fetchColumn() > 0 || (int) $c2->fetchColumn() > 0);
    return $code;
}

function register(): void
{
    $data = readJsonBody();
    $role = (string) ($data['role'] ?? '');
    $fullName = trim((string) ($data['fullName'] ?? ''));
    $fullName = mb_convert_case($fullName, MB_CASE_TITLE, 'UTF-8');
    $login = normalizeLogin((string) ($data['login'] ?? ''));
    $password = (string) ($data['password'] ?? '');
    $confirmPassword = (string) ($data['confirmPassword'] ?? '');

    if (!in_array($role, ROLES, true)) {
        respond(422, ['message' => 'Nieprawidłowa rola konta.']);
    }
    if ($fullName === '' || textLength($fullName) > 160) {
        respond(422, ['message' => 'Podaj poprawne imię i nazwisko.']);
    }
    if ($login === '' || textLength($login) > 80 || !preg_match('/^[\p{L}0-9_.-]+$/u', $login)) {
        respond(422, ['message' => 'Login może zawierać tylko litery (w tym polskie znaki), cyfry, kropki, myślniki i podkreślenia.']);
    }
    validateNewPassword($password, $confirmPassword);

    $joinKey = $role === 'student' ? strtoupper(trim((string) ($data['joinKey'] ?? ''))) : '';

    $classId = null;
    $className = null;

    if ($role === 'student' && $joinKey === '') {
        respond(422, ['message' => 'Podaj kod jednorazowy otrzymany od nauczyciela.']);
    }
    $inviteRow = null;
    $isMultiInvite = false;
    if ($role === 'student') {
        $inviteStmt = db()->prepare('SELECT * FROM invite_codes WHERE code = :code LIMIT 1');
        $inviteStmt->execute(['code' => $joinKey]);
        $inviteRow = $inviteStmt->fetch();
        if ($inviteRow === false) {
            respond(422, ['message' => 'Nieprawidłowy kod jednorazowy.']);
        }
        $isMultiInvite = isset($inviteRow['is_multi']) && (int) $inviteRow['is_multi'] === 1;
        if (!$isMultiInvite && (int) $inviteRow['used'] === 1) {
            respond(422, ['message' => 'Kod został już użyty.']);
        }
        $classStmt = db()->prepare('SELECT * FROM klasy WHERE id = :id LIMIT 1');
        $classStmt->execute(['id' => $inviteRow['class_id']]);
        $class = $classStmt->fetch();
        if ($class === false) {
            respond(422, ['message' => 'Nieprawidłowy kod jednorazowy.']);
        }
        $classId = (int) $class['id'];
        $className = (string) $class['name'];
    }

    if (findUserByLogin($login) !== null) {
        respond(422, ['message' => 'Login jest już zajęty.']);
    }

    $pdo = db();
$pdo->beginTransaction();
try {
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($role === 'student' && !$isMultiInvite) {
        $updateInvite = db()->prepare('UPDATE invite_codes SET used = 1 WHERE code = :code');
        $updateInvite->execute(['code' => $joinKey]);
    }

        if ($role === 'teacher') {
            $name = trim((string) ($data['className'] ?? ''));
            if ($name === '' || textLength($name) > 120) {
                $pdo->rollBack();
                respond(422, ['message' => 'Podaj nazwę klasy.']);
            }
            $insertClass = $pdo->prepare('INSERT INTO klasy (teacher_id, name, join_key, created_at) VALUES (NULL, :name, :key, CURRENT_TIMESTAMP)');
            $insertClass->execute(['name' => $name, 'key' => generateJoinKey()]);
            $classId = (int) $pdo->lastInsertId();
            $className = $name;
        }

        $insertUser = $pdo->prepare('INSERT INTO uzytkownicy (full_name, login, haslo, rola, class_id, data_utworzenia) VALUES (:name, :login, :haslo, :rola, :class, CURRENT_TIMESTAMP)');
        $insertUser->execute([
            'name' => $fullName,
            'login' => $login,
            'haslo' => $passwordHash,
            'rola' => $role,
            'class' => $classId,
        ]);
        $userId = (int) $pdo->lastInsertId();

        if ($role === 'teacher') {
            $update = $pdo->prepare('UPDATE klasy SET teacher_id = :teacher WHERE id = :id');
            $update->execute(['teacher' => $userId, 'id' => $classId]);
        }

        if ($role === 'student' && $inviteRow !== null && !$isMultiInvite) {
            $del = $pdo->prepare('DELETE FROM invite_codes WHERE id = :id');
            $del->execute(['id' => $inviteRow['id']]);
        }

        $user = findUserByLogin($login);
        session_regenerate_id(true);
        $_SESSION['account_id'] = $userId;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    $payload = ['account' => publicUser($user), 'csrfToken' => $_SESSION['csrf_token'], 'message' => 'Konto zostało utworzone.'];
    if ($role === 'teacher') {
        $payload['class'] = ['id' => $classId, 'name' => $className, 'joinKey' => getJoinKeyForClass((int) $classId)];
    }
    respond(201, $payload);
}

function login(): void
{
    $data = readJsonBody();
    $login = normalizeLogin((string) ($data['login'] ?? ''));
    $password = (string) ($data['password'] ?? '');
    if ($login === '' || $password === '') {
        respond(422, ['message' => 'Podaj login i hasło.']);
    }
    $user = findUserByLogin($login);
    if ($user === null || !password_verify($password, $user['haslo'])) {
        usleep(250000);
        respond(401, ['message' => 'Nieprawidłowy login lub hasło.']);
    }
    session_regenerate_id(true);
    $_SESSION['account_id'] = (int) $user['id'];
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    respond(200, ['account' => publicUser($user), 'csrfToken' => $_SESSION['csrf_token']]);
}

function currentAccount(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    $response = ['account' => publicUser($user), 'csrfToken' => $_SESSION['csrf_token']];
    if ($user['rola'] === 'teacher') {
        $response['class'] = getTeacherClass((int) $user['id']);
    }
    respond(200, $response);
}

function logout(): void
{
    requirePostMethod();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
    respond(200, ['message' => 'Wylogowano.']);
}

function getJoinKeyForClass(int $classId): ?string
{
    $statement = db()->prepare('SELECT join_key FROM klasy WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $classId]);
    $value = $statement->fetchColumn();
    return $value === false ? null : (string) $value;
}

function getTeacherClass(int $teacherId): ?array
{
    $statement = db()->prepare('SELECT * FROM klasy WHERE teacher_id = :teacher ORDER BY id ASC LIMIT 1');
    $statement->execute(['teacher' => $teacherId]);
    $row = $statement->fetch();
    if ($row === false) {
        return null;
    }
    return [
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'joinKey' => (string) $row['join_key'],
    ];
}

function getTeacherClasses(int $teacherId): array
{
    $stmt = db()->prepare('SELECT * FROM klasy WHERE teacher_id = :teacher ORDER BY id ASC');
    $stmt->execute(['teacher' => $teacherId]);
    return array_map(static fn(array $row): array => [
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'joinKey' => (string) $row['join_key'],
    ], $stmt->fetchAll());
}

function getSelectedClassForTeacher(array $user, ?int $requestedId = null): ?array
{
    $teacherId = (int) $user['id'];
    if ($requestedId !== null) {
        $stmt = db()->prepare('SELECT * FROM klasy WHERE id = :id AND teacher_id = :teacher LIMIT 1');
        $stmt->execute(['id' => $requestedId, 'teacher' => $teacherId]);
        $row = $stmt->fetch();
        if ($row !== false) {
            return ['id' => (int) $row['id'], 'name' => (string) $row['name'], 'joinKey' => (string) $row['join_key']];
        }
    }
    return getTeacherClass($teacherId);
}

function getMyClass(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel ma klasę.']);
    }
    $class = getTeacherClass((int) $user['id']);
    respond(200, ['class' => $class]);
}

function listClasses(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel ma klasy.']);
    }
    $classes = getTeacherClasses((int) $user['id']);
    respond(200, ['classes' => $classes]);
}

function createClass(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może utworzyć klasę.']);
    }
    $name = trim((string) ($data['name'] ?? ''));
    if ($name === '' || textLength($name) > 120) {
        respond(422, ['message' => 'Podaj poprawną nazwę klasy.']);
    }
    $pdo = db();
    $stmt = $pdo->prepare('INSERT INTO klasy (teacher_id, name, join_key, created_at) VALUES (:teacher, :name, :key, CURRENT_TIMESTAMP)');
    $stmt->execute(['teacher' => (int) $user['id'], 'name' => $name, 'key' => generateJoinKey()]);
    $id = (int) $pdo->lastInsertId();
    $class = ['id' => $id, 'name' => $name, 'joinKey' => getJoinKeyForClass($id)];
    respond(201, ['class' => $class, 'message' => 'Utworzono klasę.']);
}

function deleteClass(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może usunąć klasę.']);
    }
    $classId = (int)($data['classId'] ?? $data['id'] ?? 0);
    if ($classId <= 0 && isset($data['classId'])) {
        $classId = (int)$data['classId'];
    }
    // fallback: jeśli nie podano id, użyj pierwszej klasy nauczyciela
    if ($classId <= 0) {
        $cls = getTeacherClass((int)$user['id']);
        if ($cls !== null) $classId = (int)$cls['id'];
    }
    if ($classId <= 0) {
        respond(422, ['message' => 'Nie podano klasy do usunięcia.']);
    }
    $check = db()->prepare('SELECT * FROM klasy WHERE id = :id AND teacher_id = :tid LIMIT 1');
    $check->execute(['id' => $classId, 'tid' => (int)$user['id']]);
    $cls = $check->fetch();
    if ($cls === false) {
        respond(404, ['message' => 'Klasa nie znaleziona lub brak uprawnień.']);
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        // usuń uczniów w klasie
        $delStudents = $pdo->prepare("DELETE FROM uzytkownicy WHERE class_id = :cid AND rola = 'student'");
        $delStudents->execute(['cid' => $classId]);
        // usuń oceny, kody, prośby (kaskada i tak usunie, ale jawnie dla pewności)
        try { $pdo->prepare("DELETE FROM oceny WHERE class_id = :cid")->execute(['cid' => $classId]); } catch (Throwable $e) {}
        try { $pdo->prepare("DELETE FROM invite_codes WHERE class_id = :cid")->execute(['cid' => $classId]); } catch (Throwable $e) {}
        try { $pdo->prepare("DELETE FROM name_change_requests WHERE class_id = :cid")->execute(['cid' => $classId]); } catch (Throwable $e) {}
        $delClass = $pdo->prepare('DELETE FROM klasy WHERE id = :id AND teacher_id = :tid');
        $delClass->execute(['id' => $classId, 'tid' => (int)$user['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    respond(200, ['message' => 'Usunięto klasę ' . $cls['name'] . '.']);
}

function regenerateClassKey(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może wygenerować klucz.']);
    }
    $statement = db()->prepare('UPDATE klasy SET join_key = :key WHERE teacher_id = :teacher');
    $statement->execute(['teacher' => (int) $user['id'], 'key' => generateJoinKey()]);
    respond(200, ['class' => getTeacherClass((int) $user['id']), 'message' => 'Wygenerowano nowy klucz klasy.']);
}

function generateInvite(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może wygenerować kod.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $code = generateInviteCode();
    $pdo = db();
    try {
        $stmt = $pdo->prepare('INSERT INTO invite_codes (class_id, code, created_at, is_multi) VALUES (:class, :code, CURRENT_TIMESTAMP, 0)');
        $stmt->execute(['class' => $class['id'], 'code' => $code]);
    } catch (Throwable $e) {
        $stmt = $pdo->prepare('INSERT INTO invite_codes (class_id, code, created_at) VALUES (:class, :code, CURRENT_TIMESTAMP)');
        $stmt->execute(['class' => $class['id'], 'code' => $code]);
    }
    respond(201, ['code' => $code, 'message' => 'Wygenerowano jednorazowy kod.']);
}

function generateQrInvite(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może wygenerować kod.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $pdo = db();
    // Usuń poprzednie wielorazowe kody QR dla tej klasy (tylko jeden aktywny na raz)
    try {
        $delPrev = $pdo->prepare('DELETE FROM invite_codes WHERE class_id = :class AND is_multi = 1');
        $delPrev->execute(['class' => $class['id']]);
    } catch (Throwable $e) {}
    $code = generateInviteCode();
    try {
        $stmt = $pdo->prepare('INSERT INTO invite_codes (class_id, code, created_at, is_multi, used) VALUES (:class, :code, CURRENT_TIMESTAMP, 1, 0)');
        $stmt->execute(['class' => $class['id'], 'code' => $code]);
    } catch (Throwable $e) {
        // fallback if is_multi column missing
        $stmt = $pdo->prepare('INSERT INTO invite_codes (class_id, code, created_at, used) VALUES (:class, :code, CURRENT_TIMESTAMP, 0)');
        $stmt->execute(['class' => $class['id'], 'code' => $code]);
    }
    respond(201, ['code' => $code, 'message' => 'Wygenerowano wielorazowy kod QR.']);
}

function deleteQrInvite(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może usunąć kod.']);
    }
    $code = strtoupper(trim((string) ($data['code'] ?? '')));
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $pdo = db();
    if ($code !== '') {
        try {
            $stmt = $pdo->prepare('DELETE FROM invite_codes WHERE code = :code AND class_id = :class AND is_multi = 1');
            $stmt->execute(['code' => $code, 'class' => $class['id']]);
            if ($stmt->rowCount() === 0) {
                // fallback: delete even if is_multi flag missing
                $stmt2 = $pdo->prepare('DELETE FROM invite_codes WHERE code = :code AND class_id = :class');
                $stmt2->execute(['code' => $code, 'class' => $class['id']]);
            }
        } catch (Throwable $e) {
            $stmt = $pdo->prepare('DELETE FROM invite_codes WHERE code = :code AND class_id = :class');
            $stmt->execute(['code' => $code, 'class' => $class['id']]);
        }
    } else {
        // Usuń wszystkie wielorazowe kody dla klasy (gdy brak konkretnego kodu)
        try {
            $stmt = $pdo->prepare('DELETE FROM invite_codes WHERE class_id = :class AND is_multi = 1');
            $stmt->execute(['class' => $class['id']]);
        } catch (Throwable $e) {
            respond(200, ['message' => 'Brak kodu QR do usunięcia.']);
        }
    }
    respond(200, ['message' => 'Kod QR został usunięty.']);
}

function listInvites(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może zobaczyć kody.']);
    }
    $requestedId = isset($_GET['classId']) ? (int) $_GET['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(200, ['codes' => []]);
    }
    try {
        $stmt = db()->prepare('SELECT code, used, created_at, used_at FROM invite_codes WHERE class_id = :class AND used = 0 AND (is_multi = 0 OR is_multi IS NULL) ORDER BY created_at DESC, id DESC');
        $stmt->execute(['class' => $class['id']]);
    } catch (Throwable $e) {
        $stmt = db()->prepare('SELECT code, used, created_at, used_at FROM invite_codes WHERE class_id = :class AND used = 0 ORDER BY created_at DESC, id DESC');
        $stmt->execute(['class' => $class['id']]);
    }
    $codes = array_map(static fn(array $row): array => [
        'code' => (string) $row['code'],
        'used' => (bool) $row['used'],
        'createdAt' => (string) $row['created_at'],
        'usedAt' => $row['used_at'] === null ? null : (string) $row['used_at'],
    ], $stmt->fetchAll());
    respond(200, ['codes' => $codes]);
}

function deleteInvite(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może usunąć kod.']);
    }
    $code = strtoupper(trim((string) ($data['code'] ?? '')));
    if ($code === '') {
        respond(422, ['message' => 'Podaj kod do usunięcia.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $stmt = db()->prepare('DELETE FROM invite_codes WHERE code = :code AND class_id = :class');
    $stmt->execute(['code' => $code, 'class' => $class['id']]);
    if ($stmt->rowCount() === 0) {
        respond(404, ['message' => 'Kod nie znaleziony.']);
    }
    respond(200, ['message' => 'Kod został usunięty.']);
}

function listStudents(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    $pdo = db();

    if ($user['rola'] === 'teacher') {
        $requestedId = isset($_GET['classId']) ? (int) $_GET['classId'] : null;
        $class = getSelectedClassForTeacher($user, $requestedId);
        if ($class === null) {
            respond(200, ['students' => [], 'absentIds' => []]);
        }
        $statement = $pdo->prepare(
            'SELECT u.id, u.full_name, u.login, u.rola, u.class_id, u.character,
                    (SELECT COUNT(*) FROM oceny o WHERE o.student_id = u.id AND o.rodzaj = \'plus\') AS plus_count,
                    (SELECT COUNT(*) FROM oceny o WHERE o.student_id = u.id AND o.rodzaj = \'minus\') AS minus_count
             FROM uzytkownicy u
             WHERE u.rola = \'student\' AND u.class_id = :class
             ORDER BY u.full_name ASC, u.id ASC'
        );
        $statement->execute(['class' => $class['id']]);
    } else {
        $statement = $pdo->prepare(
            'SELECT u.id, u.full_name, u.login, u.rola, u.class_id, u.character, 0 AS plus_count, 0 AS minus_count
             FROM uzytkownicy u
             WHERE u.rola = \'student\' AND u.class_id = :class
             ORDER BY u.full_name ASC, u.id ASC'
        );
        $statement->execute(['class' => (int) $user['class_id']]);
    }

    $students = array_map(static fn(array $row): array => [
        'id' => (int) $row['id'],
        'fullName' => (string) $row['full_name'],
        'login' => (string) $row['login'],
        'classId' => $row['class_id'] === null ? null : (int) $row['class_id'],
        'plusCount' => (int) $row['plus_count'],
        'minusCount' => (int) $row['minus_count'],
        'character' => ($row['character'] ?? null) === null ? null : (string) $row['character'],
    ], $statement->fetchAll());

    respond(200, ['students' => $students]);
}

function addGrade(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może dodać ocenę.']);
    }
    $studentId = (int) ($data['studentId'] ?? 0);
    $type = (string) ($data['type'] ?? '');
    if (!in_array($type, ['plus', 'minus', 'absent'], true) || $studentId <= 0) {
        respond(422, ['message' => 'Nieprawidłowy rodzaj wpisu lub uczeń.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $studentStmt = db()->prepare('SELECT id FROM uzytkownicy WHERE id = :id AND rola = \'student\' AND class_id = :class LIMIT 1');
    $studentStmt->execute(['id' => $studentId, 'class' => $class['id']]);
    if ($studentStmt->fetch() === false) {
        respond(422, ['message' => 'Uczeń nie należy do twojej klasy.']);
    }
    $insert = db()->prepare('INSERT INTO oceny (class_id, student_id, teacher_id, rodzaj, data_utworzenia) VALUES (:class, :student, :teacher, :type, CURRENT_TIMESTAMP)');
    $insert->execute(['class' => $class['id'], 'student' => $studentId, 'teacher' => (int) $user['id'], 'type' => $type]);
    respond(201, ['message' => 'Wpis został dodany.']);
}

function removeStudent(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może usunąć ucznia.']);
    }
    $studentId = (int) ($data['studentId'] ?? 0);
    if ($studentId <= 0) {
        respond(422, ['message' => 'Nieprawidłowy uczeń.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $stmt = db()->prepare('SELECT id FROM uzytkownicy WHERE id = :id AND rola = \'student\' AND class_id = :class LIMIT 1');
    $stmt->execute(['id' => $studentId, 'class' => $class['id']]);
    if ($stmt->fetch() === false) {
        respond(422, ['message' => 'Uczeń nie należy do twojej klasy.']);
    }
    $delete = db()->prepare('DELETE FROM uzytkownicy WHERE id = :id');
    $delete->execute(['id' => $studentId]);
    respond(200, ['message' => 'Uczeń został usunięty.']);
}

function pendingGrades(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    $pdo = db();

    if ($user['rola'] === 'teacher') {
        $requestedId = isset($_GET['classId']) ? (int) $_GET['classId'] : null;
        $class = getSelectedClassForTeacher($user, $requestedId);
        if ($class === null) {
            respond(200, ['students' => []]);
        }
        $students = [];
        $statement = $pdo->prepare(
            'SELECT u.id, u.full_name, o.id AS ocena_id, o.rodzaj, o.data_utworzenia
             FROM uzytkownicy u
             JOIN oceny o ON o.student_id = u.id
             WHERE u.rola = \'student\' AND u.class_id = :class AND o.rodzaj IN (\'plus\',\'minus\',\'absent\')
             ORDER BY u.full_name ASC, u.id ASC, o.data_utworzenia DESC, o.id DESC'
        );
        $statement->execute(['class' => $class['id']]);
        foreach ($statement->fetchAll() as $row) {
            $studentId = (int) $row['id'];
            if (!isset($students[$studentId])) {
                $students[$studentId] = ['id' => $studentId, 'fullName' => (string) $row['full_name'], 'points' => []];
            }
            $students[$studentId]['points'][] = [
                'id' => (int) $row['ocena_id'],
                'type' => (string) $row['rodzaj'],
                'createdAt' => (string) $row['data_utworzenia'],
            ];
        }
        respond(200, ['students' => array_values($students)]);
        return;
    }

    // Student: show own pending plus/minus points
    $statement = $pdo->prepare(
        'SELECT id, rodzaj, data_utworzenia FROM oceny WHERE student_id = :student ORDER BY data_utworzenia DESC, id DESC'
    );
    $statement->execute(['student' => (int) $user['id']]);
    respond(200, ['points' => array_map(static fn(array $row): array => [
        'id' => (int) $row['id'],
        'type' => (string) $row['rodzaj'],
        'createdAt' => (string) $row['data_utworzenia'],
    ], $statement->fetchAll())]);
}

function settleGrades(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może rozliczyć.']);
    }
    $studentId = (int) ($data['studentId'] ?? 0);
    if ($studentId <= 0) {
        respond(422, ['message' => 'Nieprawidłowy uczeń.']);
    }
    $requestedId = isset($data['classId']) ? (int) $data['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(403, ['message' => 'Brak klasy.']);
    }
    $check = db()->prepare('SELECT id FROM uzytkownicy WHERE id = :id AND rola = \'student\' AND class_id = :class LIMIT 1');
    $check->execute(['id' => $studentId, 'class' => $class['id']]);
    if ($check->fetch() === false) {
        respond(422, ['message' => 'Uczeń nie należy do twojej klasy.']);
    }
    $del = db()->prepare('DELETE FROM oceny WHERE student_id = :student AND class_id = :class');
    $del->execute(['student' => $studentId, 'class' => $class['id']]);
    respond(200, ['message' => 'Rozliczono.']);
}

function updateDisplayName(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] === 'student') {
        $raw = trim((string) ($data['fullName'] ?? $data['displayName'] ?? $data['name'] ?? ''));
        $newName = mb_convert_case($raw, MB_CASE_TITLE, 'UTF-8');
        if ($newName === '' || textLength($newName) > 160) {
            respond(422, ['message' => 'Podaj poprawną wyświetlaną nazwę (1–160 znaków).']);
        }
        if ($newName === $user['full_name']) {
            respond(200, ['account' => publicUser($user), 'message' => 'Nazwa bez zmian.']);
        }
        $check = db()->prepare("SELECT id FROM name_change_requests WHERE student_id = :sid AND status = 'pending' LIMIT 1");
        $check->execute(['sid' => (int)$user['id']]);
        if ($check->fetch() !== false) {
            respond(422, ['message' => 'Masz już oczekującą prośbę. Poczekaj na decyzję nauczyciela.']);
        }
        if ($user['class_id'] === null) {
            respond(403, ['message' => 'Nie jesteś przypisany do klasy.']);
        }
        $stmt = db()->prepare("INSERT INTO name_change_requests (student_id, class_id, old_name, new_name, status, created_at) VALUES (:sid, :cid, :old, :new, 'pending', CURRENT_TIMESTAMP)");
        $stmt->execute(['sid' => (int)$user['id'], 'cid' => (int)$user['class_id'], 'old' => $user['full_name'], 'new' => $newName]);
        respond(201, ['message' => 'Wysłano prośbę do nauczyciela o zatwierdzenie.', 'pending' => ['oldName' => $user['full_name'], 'newName' => $newName]]);
    }
    $raw = trim((string) ($data['fullName'] ?? $data['displayName'] ?? $data['name'] ?? ''));
    $newName = mb_convert_case($raw, MB_CASE_TITLE, 'UTF-8');
    if ($newName === '' || textLength($newName) > 160) {
        respond(422, ['message' => 'Podaj poprawną wyświetlaną nazwę (1–160 znaków).']);
    }
    if ($newName === $user['full_name']) {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        respond(200, ['account' => publicUser($user), 'csrfToken' => $_SESSION['csrf_token'], 'message' => 'Nazwa bez zmian.']);
    }
    $stmt = db()->prepare('UPDATE uzytkownicy SET full_name = :name WHERE id = :id');
    $stmt->execute(['name' => $newName, 'id' => (int) $user['id']]);
    $updated = requireSession();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    respond(200, ['account' => publicUser($updated), 'csrfToken' => $_SESSION['csrf_token'], 'message' => 'Zaktualizowano wyświetlaną nazwę.']);
}

function requestNameChange(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'student') {
        respond(403, ['message' => 'Tylko uczeń może wysłać prośbę o zmianę nazwy.']);
    }
    $raw = trim((string) ($data['fullName'] ?? $data['newName'] ?? $data['name'] ?? ''));
    $newName = mb_convert_case($raw, MB_CASE_TITLE, 'UTF-8');
    if ($newName === '' || textLength($newName) > 160) {
        respond(422, ['message' => 'Podaj poprawną wyświetlaną nazwę (1–160 znaków).']);
    }
    if ($newName === $user['full_name']) {
        respond(422, ['message' => 'Nowa nazwa jest taka sama jak obecna.']);
    }
    $check = db()->prepare("SELECT id FROM name_change_requests WHERE student_id = :sid AND status = 'pending' LIMIT 1");
    $check->execute(['sid' => (int)$user['id']]);
    if ($check->fetch() !== false) {
        respond(422, ['message' => 'Masz już oczekującą prośbę. Poczekaj na decyzję nauczyciela.']);
    }
    if ($user['class_id'] === null) {
        respond(403, ['message' => 'Nie jesteś przypisany do klasy.']);
    }
    $stmt = db()->prepare("INSERT INTO name_change_requests (student_id, class_id, old_name, new_name, status, created_at) VALUES (:sid, :cid, :old, :new, 'pending', CURRENT_TIMESTAMP)");
    $stmt->execute(['sid' => (int)$user['id'], 'cid' => (int)$user['class_id'], 'old' => $user['full_name'], 'new' => $newName]);
    respond(201, ['message' => 'Wysłano prośbę do nauczyciela o zatwierdzenie.', 'pending' => ['oldName' => $user['full_name'], 'newName' => $newName]]);
}

function listNameRequests(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może zobaczyć prośby.']);
    }
    $requestedId = isset($_GET['classId']) ? (int)$_GET['classId'] : null;
    $class = getSelectedClassForTeacher($user, $requestedId);
    if ($class === null) {
        respond(200, ['requests' => []]);
    }
    $stmt = db()->prepare("
        SELECT r.id, r.student_id, r.old_name, r.new_name, r.status, r.created_at,
               u.login, u.full_name AS current_name
        FROM name_change_requests r
        JOIN uzytkownicy u ON u.id = r.student_id
        WHERE r.class_id = :cid AND r.status = 'pending'
        ORDER BY r.created_at ASC, r.id ASC
    ");
    $stmt->execute(['cid' => $class['id']]);
    $rows = array_map(static fn(array $row): array => [
        'id' => (int)$row['id'],
        'studentId' => (int)$row['student_id'],
        'login' => (string)$row['login'],
        'oldName' => (string)$row['old_name'],
        'newName' => (string)$row['new_name'],
        'currentName' => (string)$row['current_name'],
        'createdAt' => (string)$row['created_at'],
        'status' => (string)$row['status'],
    ], $stmt->fetchAll());
    respond(200, ['requests' => $rows]);
}

function decideNameRequest(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    if ($user['rola'] !== 'teacher') {
        respond(403, ['message' => 'Tylko nauczyciel może decydować o prośbach.']);
    }
    $requestId = (int)($data['requestId'] ?? $data['id'] ?? 0);
    $decision = strtolower(trim((string)($data['decision'] ?? $data['action'] ?? '')));
    if ($requestId <= 0 || !in_array($decision, ['approve','reject','approved','rejected'], true)) {
        respond(422, ['message' => 'Nieprawidłowe dane decyzji.']);
    }
    $norm = $decision === 'approve' || $decision === 'approved' ? 'approved' : 'rejected';
    $stmt = db()->prepare("SELECT * FROM name_change_requests WHERE id = :id LIMIT 1");
    $stmt->execute(['id' => $requestId]);
    $req = $stmt->fetch();
    if ($req === false) {
        respond(404, ['message' => 'Prośba nie znaleziona.']);
    }
    if ($req['status'] !== 'pending') {
        respond(422, ['message' => 'Prośba została już rozpatrzona.']);
    }
    $classCheck = db()->prepare("SELECT id FROM klasy WHERE id = :cid AND teacher_id = :tid LIMIT 1");
    $classCheck->execute(['cid' => $req['class_id'], 'tid' => (int)$user['id']]);
    if ($classCheck->fetch() === false) {
        respond(403, ['message' => 'Nie masz uprawnień do tej klasy.']);
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($norm === 'approved') {
            $updUser = $pdo->prepare("UPDATE uzytkownicy SET full_name = :name WHERE id = :sid");
            $updUser->execute(['name' => $req['new_name'], 'sid' => $req['student_id']]);
        }
        $updReq = $pdo->prepare("UPDATE name_change_requests SET status = :status, decided_at = CURRENT_TIMESTAMP, decided_by = :did WHERE id = :id");
        $updReq->execute(['status' => $norm, 'did' => (int)$user['id'], 'id' => $requestId]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    respond(200, ['message' => $norm === 'approved' ? 'Zatwierdzono zmianę nazwy.' : 'Odrzucono prośbę.', 'status' => $norm]);
}

function myNameRequest(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $user = requireSession();
    if ($user['rola'] !== 'student') {
        respond(403, ['message' => 'Tylko uczeń ma prośby o zmianę nazwy.']);
    }
    $stmt = db()->prepare("SELECT id, old_name, new_name, status, created_at FROM name_change_requests WHERE student_id = :sid AND status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1");
    $stmt->execute(['sid' => (int)$user['id']]);
    $row = $stmt->fetch();
    if ($row === false) {
        respond(200, ['pending' => null]);
    }
    respond(200, ['pending' => [
        'id' => (int)$row['id'],
        'oldName' => (string)$row['old_name'],
        'newName' => (string)$row['new_name'],
        'status' => (string)$row['status'],
        'createdAt' => (string)$row['created_at'],
    ]]);
}

function listCharacters(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        respond(405, ['message' => 'Dozwolona jest tylko metoda GET.']);
    }
    $base = __DIR__ . '/../images/characters';
    $dirs = @glob($base . '/*', GLOB_ONLYDIR) ?: [];
    $list = [];
    foreach ($dirs as $dir) {
        $name = basename($dir);
        $frames = @glob($dir . '/*.png') ?: [];
        $count = count($frames);
        if ($count === 0) continue;
        $preview = "images/characters/$name/${name}_0.png";
        if (!file_exists(__DIR__ . "/../$preview")) {
            $preview = "images/characters/$name/" . basename($frames[0]);
        }
        $zoom = 1.0;
        $flipX = false;
        $flipY = false;
        $offsetX = 0;
        $offsetY = 0;
        $cfgPath = $dir . '/config.json';
        if (file_exists($cfgPath)) {
            $cfg = @json_decode(@file_get_contents($cfgPath), true);
            if (is_array($cfg)) {
                if (isset($cfg['zoom']) && is_numeric($cfg['zoom'])) {
                    $zoom = (float)$cfg['zoom'];
                    if ($zoom <= 0) $zoom = 1.0;
                }
                if (isset($cfg['flipX'])) $flipX = (bool)$cfg['flipX'];
                if (isset($cfg['flipY'])) $flipY = (bool)$cfg['flipY'];
                if (isset($cfg['flip']) && is_array($cfg['flip'])) {
                    if (isset($cfg['flip']['x'])) $flipX = (bool)$cfg['flip']['x'];
                    if (isset($cfg['flip']['y'])) $flipY = (bool)$cfg['flip']['y'];
                    if (isset($cfg['flip']['horizontal'])) $flipX = (bool)$cfg['flip']['horizontal'];
                    if (isset($cfg['flip']['vertical'])) $flipY = (bool)$cfg['flip']['vertical'];
                }
                if (isset($cfg['flipH'])) $flipX = (bool)$cfg['flipH'];
                if (isset($cfg['flipV'])) $flipY = (bool)$cfg['flipV'];
                if (isset($cfg['offsetX']) && is_numeric($cfg['offsetX'])) $offsetX = (int)$cfg['offsetX'];
                if (isset($cfg['offsetY']) && is_numeric($cfg['offsetY'])) $offsetY = (int)$cfg['offsetY'];
                if (isset($cfg['offset']) && is_array($cfg['offset'])) {
                    if (isset($cfg['offset']['x']) && is_numeric($cfg['offset']['x'])) $offsetX = (int)$cfg['offset']['x'];
                    if (isset($cfg['offset']['y']) && is_numeric($cfg['offset']['y'])) $offsetY = (int)$cfg['offset']['y'];
                }
            }
        }
        $list[] = ['id' => $name, 'name' => ucfirst($name), 'frames' => $count, 'preview' => $preview, 'zoom' => $zoom, 'flipX' => $flipX, 'flipY' => $flipY, 'offsetX' => $offsetX, 'offsetY' => $offsetY];
    }
    // oryginalny żółw jako opcja
    $tZoom = 1.0; $tFlipX = false; $tFlipY = false; $tOffX = 0; $tOffY = 0;
    $tCfg = __DIR__ . '/../images/characters/turtle/config.json';
    if (file_exists($tCfg)) {
        $tc = @json_decode(@file_get_contents($tCfg), true);
        if (is_array($tc)) {
            if (isset($tc['zoom']) && is_numeric($tc['zoom']) && (float)$tc['zoom'] > 0) $tZoom = (float)$tc['zoom'];
            if (isset($tc['flipX'])) $tFlipX = (bool)$tc['flipX'];
            if (isset($tc['flipY'])) $tFlipY = (bool)$tc['flipY'];
            if (isset($tc['flip']) && is_array($tc['flip'])) {
                if (isset($tc['flip']['x'])) $tFlipX = (bool)$tc['flip']['x'];
                if (isset($tc['flip']['y'])) $tFlipY = (bool)$tc['flip']['y'];
            }
            if (isset($tc['offsetX']) && is_numeric($tc['offsetX'])) $tOffX = (int)$tc['offsetX'];
            if (isset($tc['offsetY']) && is_numeric($tc['offsetY'])) $tOffY = (int)$tc['offsetY'];
            if (isset($tc['offset']) && is_array($tc['offset'])) {
                if (isset($tc['offset']['x']) && is_numeric($tc['offset']['x'])) $tOffX = (int)$tc['offset']['x'];
                if (isset($tc['offset']['y']) && is_numeric($tc['offset']['y'])) $tOffY = (int)$tc['offset']['y'];
            }
        }
    }
    $list[] = ['id' => 'turtle', 'name' => 'Żółw', 'frames' => 1, 'preview' => null, 'zoom' => $tZoom, 'flipX' => $tFlipX, 'flipY' => $tFlipY, 'offsetX' => $tOffX, 'offsetY' => $tOffY];
    usort($list, fn($a,$b) => strcmp($a['id'], $b['id']));
    respond(200, ['characters' => $list]);
}

function setCharacter(): void
{
    $data = readJsonBody();
    requireCsrfToken();
    $user = requireSession();
    $char = trim((string)($data['character'] ?? $data['char'] ?? ''));
    if ($char === '') {
        respond(422, ['message' => 'Wybierz postać.']);
    }
    $base = __DIR__ . '/../images/characters';
    $allowed = array_map('basename', @glob($base . '/*', GLOB_ONLYDIR) ?: []);
    $allowed[] = 'turtle';
    if (!in_array($char, $allowed, true)) {
        respond(422, ['message' => 'Nieprawidłowa postać.']);
    }
    $stmt = db()->prepare('UPDATE uzytkownicy SET character = :c WHERE id = :id');
    $stmt->execute(['c' => $char, 'id' => (int)$user['id']]);
    $updated = requireSession();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    respond(200, ['account' => publicUser($updated), 'csrfToken' => $_SESSION['csrf_token'], 'message' => 'Wybrano postać.']);
}
