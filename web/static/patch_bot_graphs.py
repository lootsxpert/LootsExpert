import os

bot_js_path = "/home/ayusmans/Documents/Projects/price_tracker/LootsExpert/telegram/bot.js"
history_bot_js_path = "/home/ayusmans/Documents/Projects/price_tracker/LootsExpert/telegram/history_bot.js"

# --- PATCH history_bot.js ---
with open(history_bot_js_path, "r", encoding="utf-8") as f:
    history_bot = f.read()

old_chart_config_hb = """  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Price (₹)',
        data: prices,
        borderColor: '#4f46e5',
        borderWidth: 3,
        fill: true,
        backgroundColor: 'rgba(79, 70, 229, 0.1)',
        pointRadius: filtered.length > 20 ? 0 : 3,
        pointBackgroundColor: '#818cf8',
        lineTension: 0.1
      }]
    },
    options: {
      title: {
        display: true,
        text: (productName.substring(0, 30) + '... History Trend'),
        fontSize: 14,
        fontColor: '#1e293b'
      },
      legend: {
        display: false
      },
      scales: {
        xAxes: [{
          gridLines: { display: false }
        }],
        yAxes: [{
          ticks: {
            callback: (val) => '₹' + val
          }
        }]
      }
    }
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

new_chart_config_hb = """  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Price (₹)',
        data: prices,
        borderColor: '#4f46e5',
        borderWidth: 3,
        pointBackgroundColor: '#4f46e5',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: filtered.length > 20 ? 0 : 3,
        fill: true,
        backgroundColor: 'rgba(79, 70, 229, 0.1)',
        lineTension: 0.3
      }]
    },
    options: {
      title: {
        display: true,
        text: productName.substring(0, 32) + '... History Trend',
        fontSize: 14,
        fontColor: '#1e293b',
        fontFamily: 'Inter'
      },
      legend: {
        display: false
      },
      scales: {
        xAxes: [{
          gridLines: { display: false, drawBorder: false },
          ticks: {
            fontFamily: 'Inter',
            fontColor: '#64748b',
            fontSize: 10,
            maxTicksLimit: 8
          }
        }],
        yAxes: [{
          gridLines: { color: '#f1f5f9', drawBorder: false },
          ticks: {
            fontFamily: 'Inter',
            fontColor: '#64748b',
            fontSize: 10,
            callback: (val) => '₹' + parseInt(val).toLocaleString('en-IN')
          }
        }]
      }
    }
  };

  return `https://quickchart.io/chart?w=600&h=350&bkg=ffffff&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

if old_chart_config_hb in history_bot:
    history_bot = history_bot.replace(old_chart_config_hb, new_chart_config_hb)
    print("Success: Upgraded chart styling in history_bot.js")
else:
    print("Warning: old chart config in history_bot.js not found exactly")

with open(history_bot_js_path, "w", encoding="utf-8") as f:
    f.write(history_bot)


# --- PATCH bot.js ---
with open(bot_js_path, "r", encoding="utf-8") as f:
    bot_js = f.read()

# Replace first chartConfig in bot.js (command /pricegraph)
old_chart_config_b1 = """          const chartConfig = {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Price History (₹)',
                data: prices,
                borderColor: '#4f46e5',
                borderWidth: 2,
                fill: false,
                pointRadius: 4,
                backgroundColor: '#818cf8'
              }]
            },
            options: {
              title: {
                display: true,
                text: product.product_name.substring(0, 25) + '... Trend'
              }
            }
          };
          
          const graphUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

new_chart_config_b1 = """          const chartConfig = {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Price (₹)',
                data: prices,
                borderColor: '#4f46e5',
                borderWidth: 3,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: labels.length > 20 ? 0 : 3,
                fill: true,
                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                lineTension: 0.3
              }]
            },
            options: {
              title: {
                display: true,
                text: product.product_name.substring(0, 32) + '... Trend',
                fontSize: 14,
                fontColor: '#1e293b',
                fontFamily: 'Inter'
              },
              legend: {
                display: false
              },
              scales: {
                xAxes: [{
                  gridLines: { display: false, drawBorder: false },
                  ticks: {
                    fontFamily: 'Inter',
                    fontColor: '#64748b',
                    fontSize: 10,
                    maxTicksLimit: 8
                  }
                }],
                yAxes: [{
                  gridLines: { color: '#f1f5f9', drawBorder: false },
                  ticks: {
                    fontFamily: 'Inter',
                    fontColor: '#64748b',
                    fontSize: 10,
                    callback: (val) => '₹' + parseInt(val).toLocaleString('en-IN')
                  }
                }]
              }
            }
          };
          
          const graphUrl = `https://quickchart.io/chart?w=600&h=350&bkg=ffffff&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

if old_chart_config_b1 in bot_js:
    bot_js = bot_js.replace(old_chart_config_b1, new_chart_config_b1)
    print("Success: Upgraded first chart config in bot.js")
else:
    print("Warning: first chart config in bot.js not found exactly")

# Replace second chartConfig in bot.js (helper Deep Link/ID detail)
old_chart_config_b2 = """        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Price History (₹)',
              data: prices,
              borderColor: '#4f46e5',
              borderWidth: 2,
              fill: false,
              pointRadius: 4,
              backgroundColor: '#818cf8'
            }]
          },
          options: {
            title: {
              display: true,
              text: product.product_name.substring(0, 25) + '... Trend'
            }
          }
        };
        
        const graphUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

new_chart_config_b2 = """        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Price (₹)',
              data: prices,
              borderColor: '#4f46e5',
              borderWidth: 3,
              pointBackgroundColor: '#4f46e5',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              pointRadius: labels.length > 20 ? 0 : 3,
              fill: true,
              backgroundColor: 'rgba(79, 70, 229, 0.1)',
              lineTension: 0.3
            }]
          },
          options: {
            title: {
              display: true,
              text: product.product_name.substring(0, 32) + '... Trend',
              fontSize: 14,
              fontColor: '#1e293b',
              fontFamily: 'Inter'
            },
            legend: {
              display: false
            },
            scales: {
              xAxes: [{
                gridLines: { display: false, drawBorder: false },
                ticks: {
                  fontFamily: 'Inter',
                  fontColor: '#64748b',
                  fontSize: 10,
                  maxTicksLimit: 8
                }
              }],
              yAxes: [{
                gridLines: { color: '#f1f5f9', drawBorder: false },
                ticks: {
                  fontFamily: 'Inter',
                  fontColor: '#64748b',
                  fontSize: 10,
                  callback: (val) => '₹' + parseInt(val).toLocaleString('en-IN')
                }
              }]
            }
          }
        };
        
        const graphUrl = `https://quickchart.io/chart?w=600&h=350&bkg=ffffff&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;"""

if old_chart_config_b2 in bot_js:
    bot_js = bot_js.replace(old_chart_config_b2, new_chart_config_b2)
    print("Success: Upgraded second chart config in bot.js")
else:
    print("Warning: second chart config in bot.js not found exactly")

with open(bot_js_path, "w", encoding="utf-8") as f:
    f.write(bot_js)

print("Telegram bots graph styling upgrade completed successfully!")
