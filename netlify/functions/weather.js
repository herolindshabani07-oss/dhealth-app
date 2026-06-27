/* D Health — Weather + Air Quality proxy (OpenWeather).
   Why a proxy: the OpenWeather API key must NOT live in the browser. The client
   calls /.netlify/functions/weather?lat=..&lon=.. and we add the key here,
   server-side, then return a small combined JSON.

   OpenWeather free tier ALLOWS commercial use (unlike Open-Meteo free), with a
   visible "© OpenWeather" attribution (shown on the Home card).

   Required env var (Netlify → Site settings → Environment variables):
     OPENWEATHER_KEY   — your OpenWeather API key (free plan is enough)

   If the key is not set yet, we return 503 {code:'no_key'} so the client can
   fall back to Open-Meteo temporarily (pre-launch only).

   OpenWeather endpoints used (both on the free plan):
     /data/2.5/air_pollution  → components.pm2_5 / pm10 (µg/m³) + main.aqi (1..5)
     /data/2.5/weather        → temp, feels_like, humidity (units=metric)
   We convert PM2.5/PM10 concentrations to the US EPA AQI (0..500) so the card
   keeps showing the same familiar number/colour as before.
*/

/* US EPA AQI from a pollutant concentration, via the standard breakpoint table. */
function aqiFromBreakpoints(C, bp){
  if(C == null || isNaN(C)) return null;
  for(var i=0;i<bp.length;i++){
    var b = bp[i];
    if(C >= b[0] && C <= b[1]){
      return Math.round((b[3]-b[2])/(b[1]-b[0])*(C-b[0]) + b[2]);
    }
  }
  return 500; // above the top breakpoint
}
var PM25_BP = [[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,350.4,301,400],[350.5,500.4,401,500]];
var PM10_BP = [[0,54,0,50],[55,154,51,100],[155,254,101,150],[255,354,151,200],[355,424,201,300],[425,504,301,400],[505,604,401,500]];

function usAqi(pm25, pm10){
  var a = aqiFromBreakpoints(pm25, PM25_BP);
  var b = aqiFromBreakpoints(pm10, PM10_BP);
  if(a == null) return b;
  if(b == null) return a;
  return Math.max(a, b); // US AQI = worst sub-index
}

exports.handler = async function(event){
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=600'  // 10 min — air/weather change slowly
  };
  if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  var KEY = process.env.OPENWEATHER_KEY;
  if(!KEY) return { statusCode: 503, headers, body: JSON.stringify({ ok:false, code:'no_key', error:'OPENWEATHER_KEY not configured' }) };

  var q = event.queryStringParameters || {};
  var lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  if(isNaN(lat) || isNaN(lon)) return { statusCode: 400, headers, body: JSON.stringify({ ok:false, code:'bad_coords', error:'lat/lon required' }) };

  try{
    var base = 'https://api.openweathermap.org/data/2.5/';
    var airUrl = base+'air_pollution?lat='+lat+'&lon='+lon+'&appid='+KEY;
    var wUrl   = base+'weather?lat='+lat+'&lon='+lon+'&units=metric&appid='+KEY;

    var results = await Promise.all([ fetch(airUrl), fetch(wUrl) ]);
    var air = await results[0].json();
    var wx  = await results[1].json();

    var comp = (air && air.list && air.list[0] && air.list[0].components) || {};
    var pm25 = comp.pm2_5 != null ? Math.round(comp.pm2_5*10)/10 : null;
    var pm10 = comp.pm10  != null ? Math.round(comp.pm10*10)/10  : null;
    var aqi  = usAqi(pm25, pm10);

    var main = (wx && wx.main) || {};
    var out = {
      ok: true,
      source: 'openweather',
      aqi: aqi,
      pm25: pm25,
      pm10: pm10,
      temp: main.temp != null ? Math.round(main.temp) : null,
      feels_like: main.feels_like != null ? Math.round(main.feels_like) : null,
      humidity: main.humidity != null ? Math.round(main.humidity) : null,
      wind: (wx && wx.wind && wx.wind.speed != null) ? Math.round(wx.wind.speed*3.6) : null, // m/s → km/h
      city: (wx && wx.name) || null
    };
    if(out.aqi == null && out.temp == null){
      return { statusCode: 502, headers, body: JSON.stringify({ ok:false, code:'upstream', error:'No data from OpenWeather' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(out) };
  }catch(e){
    return { statusCode: 502, headers, body: JSON.stringify({ ok:false, code:'fetch_failed', error: String(e && e.message || e) }) };
  }
};
