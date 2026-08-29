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
        'list-invites' => listInvites(),
        'delete-invite' => deleteInvite(),
        'create-class' => createClass(),
        'settle-grades' => settleGrades(),
        'list-classes' => listClasses(),
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
    if ($role === 'student') {
        $inviteStmt = db()->prepare('SELECT * FROM invite_codes WHERE code = :code LIMIT 1');
        $inviteStmt->execute(['code' => $joinKey]);
        $inviteRow = $inviteStmt->fetch();
        if ($inviteRow === false) {
            respond(422, ['message' => 'Nieprawidłowy kod jednorazowy.']);
        }
        if ((int) $inviteRow['used'] === 1) {
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
    $updateInvite = db()->prepare('UPDATE invite_codes SET used = 1 WHERE code = :code');
    $updateInvite->execute(['code' => $joinKey]);

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

        if ($role === 'student' && $inviteRow !== null) {
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
    $code = generateJoinKey();
    $pdo = db();
    $stmt = $pdo->prepare('INSERT INTO invite_codes (class_id, code, created_at) VALUES (:class, :code, CURRENT_TIMESTAMP)');
    $stmt->execute(['class' => $class['id'], 'code' => $code]);
    respond(201, ['code' => $code, 'message' => 'Wygenerowano jednorazowy kod.']);
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
    $stmt = db()->prepare('SELECT code, used, created_at, used_at FROM invite_codes WHERE class_id = :class AND used = 0 ORDER BY created_at DESC, id DESC');
    $stmt->execute(['class' => $class['id']]);
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
            'SELECT u.id, u.full_name, u.login, u.rola, u.class_id,
                    (SELECT COUNT(*) FROM oceny o WHERE o.student_id = u.id AND o.rodzaj = \'plus\') AS plus_count,
                    (SELECT COUNT(*) FROM oceny o WHERE o.student_id = u.id AND o.rodzaj = \'minus\') AS minus_count
             FROM uzytkownicy u
             WHERE u.rola = \'student\' AND u.class_id = :class
             ORDER BY u.full_name ASC, u.id ASC'
        );
        $statement->execute(['class' => $class['id']]);
    } else {
        $statement = $pdo->prepare(
            'SELECT u.id, u.full_name, u.login, u.rola, u.class_id, 0 AS plus_count, 0 AS minus_count
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
