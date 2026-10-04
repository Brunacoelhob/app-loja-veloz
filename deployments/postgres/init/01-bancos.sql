-- Um banco por serviço: cada microsserviço é dono dos próprios dados e nenhum lê o banco do outro.
-- (Rodado automaticamente na primeira vez que o volume do Postgres é criado.)
CREATE DATABASE pedidos_db;
CREATE DATABASE estoque_db;
