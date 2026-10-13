FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && docker-php-ext-install curl \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

COPY docker/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY docker/start-apache.sh /usr/local/bin/start-apache.sh
RUN chmod +x /usr/local/bin/start-apache.sh

COPY . /var/www/html

EXPOSE 10000
CMD ["start-apache.sh"]
