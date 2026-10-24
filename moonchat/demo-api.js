async function demoFetch(path, options) {
  if (path === '/api/status') return Response.json({mode:'demo'});
  const {scene,tone,messages}=JSON.parse(options.body);
  const last=messages.at(-1).content;
  const settings={
    '雨夜咖啡館':'雨點在玻璃上畫出細細的線，桌上的熱茶冒著白煙。',
    '海邊散步':'天空染著淡淡的橘色，海浪輕輕碰著岸邊。',
    '星空露台':'城市的燈光在遠處閃爍，我們抬頭望向安靜的星空。'
  };
  let reply=/風景|描述/.test(last)?settings[scene]:/累|疲倦/.test(last)?'辛苦了。先把肩膀放鬆，今天不必急著把每件事情都做好。':/晚安/.test(last)?'晚安，願今晚有個柔軟的夢。':settings[scene];
  reply+=tone==='輕鬆幽默'?' 今天有什麼小插曲，值得我們一起笑一笑？':tone==='安靜陪伴'?' 不急著說話也沒關係，就讓這一刻慢一點。':' 想和我說說你現在的心情嗎？';
  return Response.json({mode:'demo',reply:'（預設示範回覆，非 AI 生成）\n'+reply});
}
