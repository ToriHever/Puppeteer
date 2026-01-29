// Настройка браузера
export async function configureBrowser(page, cookies, config) {
  // Устанавливаем User-Agent
  await page.setUserAgent(config.userAgent);

  // Устанавливаем viewport
  await page.setViewport(config.viewport);

  // Устанавливаем куки из файла (если есть)
  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log('✓ Куки успешно установлены');
  }

  // Скрываем признаки автоматизации
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['ru-RU', 'ru', 'en-US', 'en']
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Переопределяем permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // Добавляем chrome объект
    window.chrome = {
      runtime: {}
    };
  });

  // Устанавливаем дополнительные заголовки
  if (config.extraHeaders) {
    await page.setExtraHTTPHeaders(config.extraHeaders);
  }
}