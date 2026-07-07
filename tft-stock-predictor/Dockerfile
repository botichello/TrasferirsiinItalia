# Runs the TFT predictor CLI. Build from the tft-stock-predictor directory:
#   docker build -t tft-predictor .
#   docker run --rm -v tft-artifacts:/app/artifacts tft-predictor \
#       train --tickers BTC-USD --provider coinbase --interval 1h
#   docker run --rm -p 8000:8000 -v tft-artifacts:/app/artifacts tft-predictor \
#       live --artifacts artifacts/BTC-USD_1h --dashboard 8000 --dashboard-host 0.0.0.0
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir -r requirements.txt

COPY tft_predictor/ tft_predictor/
EXPOSE 8000

ENTRYPOINT ["python", "-m", "tft_predictor"]
CMD ["--help"]
