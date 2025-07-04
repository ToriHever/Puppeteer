# Puppeteer
Скрипты для автоматизации работы в браузере

Что бы начать работу нужно установитть Pupeteer. Команда для установки: npm install puppeteer.

# Описание проекта
В данном проекте находятся скрипты для автоматической работы в браузере. На данный момент 15.01.25 проект содержит 2 скрипта.
1. Parser_domen: Парсит список доменов на сайте https://check-host.net/ забирая значения Организации и Провайдера. Сохраняет результаты в папку Resuilt в .csv файле. 
2. Parser_request: Парсит список запросов на сайте https://wordstat.yandex.ru/. Забирает значния частоту в трех видах: Обычная частота, Частота с оператором "", Частота с операторами "!". Сохраняет результаты в папку Resuilt в .csv файле.

# Начало работы работы с парсерами
Для начала работы скриптов, требуется установить Node.js и Puppeteer через консоль cmd. 

// ВАЖНО для отправки уведомлений в тг, о статусах работы парсера, нужно написать в тг @tori_hever, что бы добавить пользователя для отправки уведомлений. 
// ВАЖНО при первом запуске скрипта, будет происходить аворизация (или нет), если произойдет, то потребуется код для доступа с акаунта @tori_hever. Нужно ввести этот код, страница автоматически передйт дальше, мы ее больше не трогаем, а идем в консоль нажимаем на нее, что бы она стала активным окном и нажимает enter. Далее скрипт пойдет по своему стандартному коду. 

1. Устанавливаем Node.js с сайта https://nodejs.org/en/download. 
2. Переходим про этой ссылке: https://github.com/ToriHever/Puppeteer
3. Нажимаем на зеленую кнопку "<> Code", в контекстном меню выбераем Dowland ZIP. 
4. Скаченый архив распоковываем на рабочий стол. Можно распоковать куда угодно, но тогда прийдется править дополнительно файл run_parser_request.bat. Так как там прописан путь открытия файла именно с рабочего стола. 
5. Теперь для установки нужных библиотек и модулей js нужно перейти в распокованую ранее папку через командную строку cmd.
6. Открываем консоль win+r
7. Вводим: cmd
8. Вводим в консоль: cd "путь к папке Puppeteer". Нужно убедится что команда отработал аи нашла по указному пути нужнцую папку и волшла в нее, сделать это можно посмотрев на путь в строке выше строки ввода, елси там крайняя папка Puppeteer, то все хорошо и продолжаем дальше. 
9. Вводим команду для утстановки puppeteer: npm install puppeteer
10. Вводим команду для устновки зависимостей: npm install

На этом установка скрипта завершена и должна корректно работать. Если что то не ладиться пишите в тг @tori_hever с описанием проблеммы и скопированной ошибкой в консоли, если она есть.

Общий принцип работы с парсерами прост. В папках каждого парсера лежит документ .txt с названием request или domen. В этот документ вносится список элементов, каждый элемент с новой строки, с которыми ведется дальнейшая работа парсера.

// ВАЖНО при работе скрипта с консоли cmd - забудьте о существовании буфер обмена на вашем ПК, так как для работы скрипту нужна буфер обмена для работы с завпросами.

# Установка Git на пк
https://selectel.ru/blog/tutorials/how-to-install-git-to-windows/ 
После окончания установки. Открываем папку Puppeteer, в этйо открытой папке на пустом поле кликаем ПКМ имещм Open Git Bash here.
Вводим в открывшеюся консоль: node Parser_request/wordstat-parser-ctrlV.js
Введеный выше код это пусть к скрипту, который его запустит.

// ВАЖНО не забудьте ручками открыть фал с запросами или списокм доменов и внести туда сови данные. 
# Работа с парсером Parser_request 

Заходим в папку с названеим парсера. Ищем run_parser_request.bat запускаем. Он откроет тектовый файл с запросами, он может быть пустым или уже с запросами. Смело очищаем его и вносим свои данные. Каждый запрос с новой стороки. Сохраняем ctrl+s и закрываем текстовый доукумент. После закрытия скрипт начнет свою работу. ВАЖНО не закрывать консоль и открытое окно браузера, до окончания работы. О состояниии работы парсера можно помотреть в консоли. 

Parser_request - создан 2 файл "wordstat-parser-ctrlV2.js" с версией где ожидается конец програзуки страницы. Скрипт работает не кореектно. Рекомендуется использовать "wordstat-parser-ctrlV.js"

# Добавлены команды ручного управления в консоли 

Это сделано потому что яндекс начинает блокировать парсер, не пропускать его, при одной и той же куки, меняет логику авторизации. Поэтому приходится удалиять куки и пересохрнатяь их. Раньше это белалось автоматически, но при опредленном сценарии. Что бы постоянно не менять скрипт, принято решение ввести ручное управление 

login — ручной вход и сохранение куки;

save-cookie — принудительное сохранение текущих куки;

run — проверка, что вы на странице Wordstat, и запуск парсинга.



# 📌 Назначение парсеров UniSender

Скрипт автоматически парсит таблицу с контактами из сервиса UniSender (раздел CDP, список с id=1132) и сохраняет данные в .csv файл. Использует cookies для входа и поддерживает постраничный переход.
# 🖥️ Где работает

На сайте: https://cp.unisender.com/ru/v5/cdp/lists/1132

Требует ручной вход при первом запуске, после чего сохраняет cookies для последующих запусков без авторизации.

# ⚙️ Принцип работы

1. Загрузка cookies:

2. Загружает файл cookiesWordstat.json, если он есть, и применяет их для авторизации.

3. Проверка авторизации:

4. Если после загрузки cookies вы не попали на нужную страницу (TARGET_URL), скрипт ждёт ручной авторизации (waitForEnter()), затем сохраняет cookies.

5. Парсинг таблицы:

6. Извлекает данные из <table> на странице.

7. Сохраняет их в contacts.csv. Первая страница — перезапись, остальные — добавление.

8. Навигация по страницам:

9. Ищет блок пагинации и кликает на последний элемент (следующая страница), пока это возможно.

10. Ждёт 5 секунд между переходами.

11. Завершение: После прохода по всем страницам — закрывает браузер.

# 📁 Файлы, которые использует

| Файл                  | Назначение                                     |
|-----------------------|------------------------------------------------|
| cookiesWordstat.json  | Хранение cookies для авторизации               |
| contacts.csv          | Результирующий CSV-файл с данными из таблицы   |

Файл	Назначение
cookiesWordstat.json	Хранение cookies для авторизации
contacts.csv	Результирующий CSV-файл с данными из таблицы
# 🔄 Цикл работы

1. Запуск скрипта → загрузка сайта и cookies.

2. При необходимости — ручной вход и сохранение cookies.

3. Парсинг таблицы → переход на следующую страницу → повтор.

4. Остановка при отсутствии следующей страницы или ошибки.

5. Закрытие браузера.